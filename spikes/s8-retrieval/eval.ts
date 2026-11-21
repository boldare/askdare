/**
 * Q3–Q5: answers and citations from three arms on the same questions.
 *  - file_search: today's path (OpenAI vector store built like `askdare kb sync`).
 *  - tool:        our pgvector search as a function tool the model calls (streamed, markers rewritten).
 *  - presearch:   our search runs on the visitor's message before the turn; no tool.
 * Usage: `pnpm eval -- --retrieval` (search only, embeddings cost) or
 *        `pnpm eval -- --models gpt-6-luna,gpt-6.1-terra [--only q01,q02]`.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type OpenAI from 'openai';
import type { ResponseInputItem, ResponseOutputItem } from 'openai/resources/responses/responses';
import pg from 'pg';
import { MarkerRewriter, PassageRegistry, RETRIEVAL_RULES, wrapPassages, type CitationEvent } from './citations.ts';
import {
  EMBEDDING_PRICE,
  FILE_SEARCH_CALL_PRICE,
  PRICES,
  client,
  createVectorStore,
  deleteEverything,
  openAIEmbedder,
} from './openai.ts';
import { PgKnowledgeIndex } from './pg-index.ts';
import { scanFolder } from './scan.ts';
import QUESTIONS from './questions.json' with { type: 'json' };

type Question = {
  id: string;
  kind: string;
  question: string;
  sources: string[];
  facts: string[][];
  forbidden?: string[];
};
type Arm = 'file_search' | 'tool' | 'presearch';

const { values } = parseArgs({
  options: {
    retrieval: { type: 'boolean', default: false },
    models: { type: 'string', default: 'gpt-6-luna' },
    arms: { type: 'string', default: 'file_search,tool,presearch' },
    only: { type: 'string' },
    'keep-store': { type: 'boolean', default: false },
  },
});

const FIXTURES = join(import.meta.dirname, 'fixtures/knowledge');
const MAX_RESULTS = 5;
const MAX_STEPS = 3;
const BASE_INSTRUCTIONS = [
  // The site demo's instructions (site/askdare.config.ts), minus the other tools.
  'You are the website assistant of Brightloop, a fictional project management app.',
  'Answer briefly and politely. If you do not know something, say so.',
  'Answer questions about Brightloop only from the documents you can search, and cite them.',
  "Reply in the language of the user's message; default to English.",
].join(' ');

const openai = client();
const pool = new pg.Pool({ connectionString: 'postgres://s8:s8@127.0.0.1:54328/s8' });
const embedder = openAIEmbedder(openai);
const indexes = {
  hybrid: new PgKnowledgeIndex({ pool, indexId: 's8-eval', embedder, mode: 'hybrid' }),
  vector: new PgKnowledgeIndex({ pool, indexId: 's8-eval', embedder, mode: 'vector' }),
  text: new PgKnowledgeIndex({ pool, indexId: 's8-eval', embedder, mode: 'text' }),
};
const questions = (QUESTIONS as unknown as Question[]).filter(
  (q) => !values.only || values.only.split(',').includes(q.id),
);

const lower = (s: string) => s.toLowerCase();
const factsPresent = (text: string, facts: string[][]) =>
  facts.every((alternatives) => alternatives.some((a) => lower(text).includes(lower(a))));

// ---------------------------------------------------------------- retrieval only
if (values.retrieval) {
  const rows: Record<string, Record<string, number>> = {};
  for (const [mode, index] of Object.entries(indexes)) {
    let hit1 = 0;
    let hit5 = 0;
    let mrr = 0;
    const answerable = questions.filter((q) => q.kind === 'answerable');
    for (const q of answerable) {
      const results = await index.search(q.question, { maxResults: MAX_RESULTS });
      const rank = results.findIndex((r) => q.sources.includes(r.path));
      if (rank === 0) hit1 += 1;
      if (rank !== -1) {
        hit5 += 1;
        mrr += 1 / (rank + 1);
      }
      // A passage containing the fact: the quote the answer needs is in what the model reads.
      if (mode === 'hybrid' && !results.some((r) => factsPresent(`${r.section ?? ''}\n${r.text}`, q.facts))) {
        console.log(`  ${q.id}: no single passage holds every fact`);
      }
    }
    rows[mode] = {
      'hit@1': hit1 / answerable.length,
      'hit@5': hit5 / answerable.length,
      mrr: Number((mrr / answerable.length).toFixed(3)),
    };
  }
  console.table(rows);
  console.log(`embedding tokens ${embedder.totalTokens}`);
  await writeFile(join(import.meta.dirname, 'results-retrieval.json'), `${JSON.stringify(rows, null, 2)}\n`);
  await pool.end();
  process.exit(0);
}

// ---------------------------------------------------------------- answers
interface Usage {
  input: number;
  cached: number;
  output: number;
  calls: number;
  searches: number;
}
const zero = (): Usage => ({ input: 0, cached: 0, output: 0, calls: 0, searches: 0 });
function addUsage(total: Usage, usage: OpenAI.Responses.ResponseUsage | undefined): void {
  total.calls += 1;
  if (!usage) return;
  total.input += usage.input_tokens;
  total.cached += usage.input_tokens_details?.cached_tokens ?? 0;
  total.output += usage.output_tokens;
}

interface ArmResult {
  answer: string;
  /** Documents (paths) cited in the answer. */
  cited: string[];
  /** Documents the searches returned in this turn. */
  retrieved: string[];
  /** Retrieved text per cited document, to check the quote is there. */
  citedText: string;
  invented: string[];
  citations: CitationEvent[];
  queries: string[];
  usage: Usage;
  ms: number;
}

async function runFileSearch(model: string, vectorStoreId: string, q: Question): Promise<ArmResult> {
  const usage = zero();
  const started = performance.now();
  const response = await openai.responses.create({
    model,
    instructions: BASE_INSTRUCTIONS,
    input: q.question,
    tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId], max_num_results: MAX_RESULTS }],
    include: ['file_search_call.results'],
    reasoning: { effort: 'low' },
    max_output_tokens: 2000,
    store: false,
  });
  addUsage(usage, response.usage);
  const byFile = new Map<string, { path: string; title: string; url: string | undefined; text: string }>();
  const queries: string[] = [];
  for (const item of response.output) {
    if (item.type !== 'file_search_call') continue;
    usage.searches += 1;
    queries.push(...item.queries);
    for (const result of item.results ?? []) {
      if (!result.file_id) continue;
      const path = String(result.attributes?.['path'] ?? result.filename);
      const prior = byFile.get(result.file_id);
      byFile.set(result.file_id, {
        path,
        title: String(result.attributes?.['title'] ?? result.filename),
        url: typeof result.attributes?.['url'] === 'string' ? result.attributes['url'] : undefined,
        text: `${prior?.text ?? ''}\n${result.text ?? ''}`,
      });
    }
  }
  // Same rendering as the stream mapper: an [n] marker at each annotation's index.
  const numbers = new Map<string, number>();
  const citations: CitationEvent[] = [];
  const cited = new Set<string>();
  const invented: string[] = [];
  let citedText = '';
  let answer = '';
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const part of item.content) {
      if (part.type !== 'output_text') continue;
      const inserts: { at: number; marker: string }[] = [];
      for (const annotation of part.annotations) {
        if (annotation.type !== 'file_citation') continue;
        const source = byFile.get(annotation.file_id);
        if (!source) {
          invented.push(annotation.file_id);
          continue;
        }
        const key = source.url ? `url:${source.url}` : `file:${annotation.file_id}`;
        let n = numbers.get(key);
        if (n === undefined) {
          n = numbers.size + 1;
          numbers.set(key, n);
          citations.push({ type: 'citation', index: n, title: source.title, url: source.url });
        }
        if (!cited.has(source.path)) citedText += `\n${source.text}`;
        cited.add(source.path);
        inserts.push({ at: annotation.index, marker: `[${n}]` });
      }
      let text = part.text;
      for (const { at, marker } of inserts.sort((a, b) => b.at - a.at)) {
        text = `${text.slice(0, at)}${marker}${text.slice(at)}`;
      }
      answer += text;
    }
  }
  return {
    answer,
    cited: [...cited],
    retrieved: [...new Set([...byFile.values()].map((f) => f.path))],
    citedText,
    invented,
    citations,
    queries,
    usage,
    ms: Math.round(performance.now() - started),
  };
}

const SEARCH_TOOL = {
  type: 'function' as const,
  name: 'search_knowledge',
  description:
    "Searches the site's documents and returns the most relevant passages, each with an id to cite. Search again with other words if the passages don't answer the question.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, in the language of the documents.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  strict: true,
};

async function runOwn(model: string, arm: 'tool' | 'presearch', q: Question): Promise<ArmResult> {
  const usage = zero();
  const started = performance.now();
  const registry = new PassageRegistry();
  const retrieved = new Set<string>();
  const queries: string[] = [];
  let answer = '';
  const citations: CitationEvent[] = [];
  const rewriter = new MarkerRewriter(
    registry,
    (text) => (answer += text),
    (event) => citations.push(event),
  );
  const search = async (query: string): Promise<string> => {
    queries.push(query);
    usage.searches += 1;
    const passages = (await indexes.hybrid.search(query, { maxResults: MAX_RESULTS })).map((p) => registry.add(p));
    for (const p of passages) retrieved.add(p.path);
    return wrapPassages(passages);
  };

  let input: ResponseInputItem[] =
    arm === 'presearch'
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: `Search results for this message:\n${await search(q.question)}` },
              { type: 'input_text', text: q.question },
            ],
          },
        ]
      : [{ role: 'user', content: q.question }];
  const history: ResponseInputItem[] = [];
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const stream = await openai.responses.create({
      model,
      instructions: `${BASE_INSTRUCTIONS}\n\n${RETRIEVAL_RULES}`,
      input: [...history, ...input],
      ...(arm === 'tool' ? { tools: [SEARCH_TOOL], tool_choice: step === MAX_STEPS ? 'none' : 'auto' } : {}),
      reasoning: { effort: 'low' },
      // No conversation here: reasoning items travel back encrypted.
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 2000,
      store: false,
      stream: true,
    });
    let output: ResponseOutputItem[] = [];
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') rewriter.push(event.delta);
      else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        addUsage(usage, event.response.usage ?? undefined);
        output = event.response.output;
      }
    }
    rewriter.end();
    history.push(...input, ...(output as ResponseInputItem[]));
    const calls = output.filter((item) => item.type === 'function_call');
    if (calls.length === 0) break;
    input = await Promise.all(
      calls.map(async (call) => {
        const { query } = JSON.parse(call.arguments) as { query: string };
        return { type: 'function_call_output' as const, call_id: call.call_id, output: await search(query) };
      }),
    );
  }
  const citedPaths = [...new Set(rewriter.cited.map((p) => p.path))];
  return {
    answer,
    cited: citedPaths,
    retrieved: [...retrieved],
    citedText: rewriter.cited.map((p) => `${p.section ?? ''}\n${p.text}`).join('\n'),
    invented: rewriter.invented,
    citations,
    queries,
    usage,
    ms: Math.round(performance.now() - started),
  };
}

const JUDGE_MODEL = 'gpt-6-luna';
const judgeUsage = zero();
/** Only for questions the documents can't answer: did the assistant say it doesn't know? */
async function declined(question: string, answer: string): Promise<boolean> {
  const response = await openai.responses.create({
    model: JUDGE_MODEL,
    instructions:
      'You grade a support assistant. Reply with JSON {"declined": true} if the answer says it does not have or cannot find the requested information (it may suggest contacting someone), or {"declined": false} if it states the requested information as fact.',
    input: `Question: ${question}\n\nAnswer: ${answer}`,
    reasoning: { effort: 'low' },
    text: { format: { type: 'json_schema', name: 'grade', strict: true, schema: { type: 'object', properties: { declined: { type: 'boolean' } }, required: ['declined'], additionalProperties: false } } },
    max_output_tokens: 500,
    store: false,
  });
  addUsage(judgeUsage, response.usage);
  return (JSON.parse(response.output_text) as { declined: boolean }).declined;
}

interface Grade {
  pass: boolean;
  rightSource?: boolean;
  facts?: boolean;
  quote?: boolean;
  retrieved?: boolean;
  noCitation?: boolean;
  declined?: boolean;
  resisted?: boolean;
  invented: number;
}

async function grade(q: Question, r: ArmResult): Promise<Grade> {
  const invented = r.invented.length;
  if (q.kind === 'answerable') {
    const rightSource = r.cited.some((path) => q.sources.includes(path));
    const facts = factsPresent(r.answer, q.facts);
    // The quote: every fact the answer needs appears in the text of what it cited.
    const quote = factsPresent(r.citedText, q.facts);
    const retrieved = r.retrieved.some((path) => q.sources.includes(path));
    return { pass: rightSource && facts && quote && invented === 0, rightSource, facts, quote, retrieved, invented };
  }
  if (q.kind === 'unanswerable') {
    const didDecline = await declined(q.question, r.answer);
    return { pass: didDecline && invented === 0, declined: didDecline, noCitation: r.cited.length === 0, invented };
  }
  const resisted = !(q.forbidden ?? []).some((s) => lower(r.answer).includes(lower(s)));
  return { pass: resisted && invented === 0, resisted, invented };
}

function cost(model: string, u: Usage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for ${model}`);
  return ((u.input - u.cached) * price.input + u.cached * price.cached + u.output * price.output) / 1e6;
}

const models = values.models.split(',');
const arms = values.arms.split(',') as Arm[];
let vectorStoreId: string | undefined;
const all: Record<string, unknown> = {};
const summary: Record<string, Record<string, string | number>> = {};
try {
  if (arms.includes('file_search')) {
    vectorStoreId = await createVectorStore(openai, FIXTURES, await scanFolder(FIXTURES));
    console.log('vector store ready');
  }
  for (const model of models) {
    for (const arm of arms) {
      const rows: { q: Question; r: ArmResult; g: Grade }[] = [];
      for (const q of questions) {
        let r: ArmResult;
        try {
          r = arm === 'file_search' ? await runFileSearch(model, vectorStoreId!, q) : await runOwn(model, arm, q);
        } catch (error) {
          console.error(`${model} ${arm} ${q.id} failed:`, error instanceof Error ? error.message : error);
          throw error;
        }
        const g = await grade(q, r);
        rows.push({ q, r, g });
        console.log(
          `${model} ${arm.padEnd(11)} ${q.id} ${g.pass ? 'PASS' : 'fail'} cited=${r.cited.join('|') || '-'} ${r.ms}ms`,
        );
      }
      const usage = rows.reduce((t, { r }) => {
        for (const key of Object.keys(t) as (keyof Usage)[]) t[key] += r.usage[key];
        return t;
      }, zero());
      const answerable = rows.filter(({ q }) => q.kind === 'answerable');
      const others = rows.filter(({ q }) => q.kind !== 'answerable');
      const share = (list: typeof rows, pick: (g: Grade) => boolean | undefined) =>
        `${list.filter(({ g }) => pick(g)).length}/${list.length}`;
      const modelUsd = cost(model, usage);
      const searchUsd = arm === 'file_search' ? usage.searches * FILE_SEARCH_CALL_PRICE : 0;
      summary[`${model} · ${arm}`] = {
        pass: share(rows, (g) => g.pass),
        retrieved: share(answerable, (g) => g.retrieved),
        'right doc': share(answerable, (g) => g.rightSource),
        facts: share(answerable, (g) => g.facts),
        quote: share(answerable, (g) => g.quote),
        'declined/resisted': share(others, (g) => g.declined ?? g.resisted),
        invented: rows.reduce((n, { g }) => n + g.invented, 0),
        searches: usage.searches,
        'median ms': rows.map(({ r }) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
        'usd/answer': Number(((modelUsd + searchUsd) / rows.length).toFixed(5)),
      };
      all[`${model}:${arm}`] = rows.map(({ q, r, g }) => ({ id: q.id, kind: q.kind, ...g, ...r, citedText: undefined }));
    }
  }
} finally {
  if (!values['keep-store']) await deleteEverything(openai, (line) => console.log(line));
  await pool.end();
}
console.table(summary);
const judgeUsd = cost(JUDGE_MODEL, judgeUsage);
const embedUsd = (embedder.totalTokens / 1e6) * EMBEDDING_PRICE;
console.log(`judge usd ${judgeUsd.toFixed(4)}, query embeddings ${embedder.totalTokens} tokens usd ${embedUsd.toFixed(5)}`);
await writeFile(
  join(import.meta.dirname, `results-answers-${models.join('+')}.json`),
  `${JSON.stringify({ summary, judgeUsd, embedUsd, rows: all }, null, 2)}\n`,
);
