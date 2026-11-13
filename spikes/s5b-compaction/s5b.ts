/**
 * Spike S5b: server-side compaction (`context_management`) at a realistic 50k-token threshold,
 * sent the way askdare sends a turn (ADR-0003, packages/askdare/src/openai/turn.ts).
 *
 *   pnpm install --ignore-workspace && pnpm start
 *
 * Reads OPENAI_API_KEY from ../../.env.smoke.local or the starter's .env.local. Never prints the key.
 * Writes results.json and redacted fixtures of compacting responses, and deletes every resource
 * it creates.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI, { APIError, toFile } from 'openai';
import type {
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseStreamEvent,
  Tool,
} from 'openai/resources/responses/responses';

if (!process.env['OPENAI_API_KEY']) {
  console.error('Set OPENAI_API_KEY in .env.smoke.local (see docs/live-testing.md).');
  process.exit(1);
}

// Per 1M tokens, Standard, short context (https://developers.openai.com/api/docs/pricing, 2026-11-12).
// The model IDs live in this spike only; the library never hardcodes one.
const PRICES = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, write: 1.25, output: 5 },
} as const;
type Model = keyof typeof PRICES;
const FILE_SEARCH_CALL_USD = 2.5 / 1000;
/** Worst case (every input token billed as a cache write). New scenarios stop above this. */
const BUDGET_USD = 1.5;

const THRESHOLD = 50_000;
/** Tokens of fixture text per filler message, calibrated with the input token count endpoint. */
const FILLER_TOKENS = 12_000;
const MAX_STEPS = 4;

// --- capture compacting responses as fixtures ---------------------------------------------------
const captured: { label: string; body: string }[] = [];
let captureLabel: string | undefined;
const capturingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const label = captureLabel;
  const type = response.headers.get('content-type') ?? '';
  if (label && response.body && type.includes('text/event-stream')) {
    const [forSdk, forFixture] = response.body.tee();
    void new Response(forFixture).text().then((body) => {
      if (body.includes('"type":"compaction"')) captured.push({ label, body });
    });
    return new Response(forSdk, { status: response.status, headers: response.headers });
  }
  return response;
};

const client = new OpenAI({ fetch: capturingFetch, maxRetries: 1, timeout: 300_000 });
const cleanup = { conversations: new Set<string>(), files: new Set<string>(), vectorStores: new Set<string>() };
const results: Record<string, unknown> = { sdk: '7.52.0', threshold: THRESHOLD, startedAt: new Date().toISOString() };
const SAFETY_ID = createHash('sha256').update('askdare-spike-s5b').digest('hex');

interface Totals {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  fileSearchCalls: number;
  responses: number;
}
const totals = new Map<Model, Totals>();
const totalsFor = (model: Model): Totals => {
  let entry = totals.get(model);
  if (!entry) {
    entry = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, fileSearchCalls: 0, responses: 0 };
    totals.set(model, entry);
  }
  return entry;
};
function costUsd(model: Model, t: Totals, worstCase: boolean): number {
  const p = PRICES[model];
  const inputUsd = worstCase
    ? t.input * p.write
    : (t.input - t.cached - t.cacheWrite) * p.input + t.cached * p.cached + t.cacheWrite * p.write;
  return (inputUsd + t.output * p.output) / 1_000_000 + t.fileSearchCalls * FILE_SEARCH_CALL_USD;
}
const spent = (worstCase: boolean): number =>
  [...totals].reduce((sum, [model, t]) => sum + costUsd(model, t, worstCase), 0);

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof APIError) {
    return { kind: error.constructor.name, status: error.status, code: error.code, param: error.param, message: error.message };
  }
  return { kind: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) };
}

// --- one Responses API call, streamed ----------------------------------------------------------
interface StepResult {
  readonly responseId: string | undefined;
  readonly text: string;
  readonly ttftMs: number | undefined;
  readonly totalMs: number;
  readonly status: string | undefined;
  readonly incompleteReason: string | undefined;
  readonly usage: { input: number; cached: number; cacheWrite: number; output: number; reasoning: number } | undefined;
  readonly outputTypes: string[];
  readonly functionCalls: { call_id: string; name: string; arguments: string }[];
  readonly compactions: { outputIndex: number; position: 'before-answer' | 'after-answer' | 'no-answer'; ms: number | undefined; encryptedChars: number }[];
  readonly compactingEvents: number;
  readonly fileSearchCalls: number;
  readonly fileCitations: number;
  readonly error?: Record<string, unknown>;
}

async function streamStep(
  model: Model,
  params: Omit<ResponseCreateParamsStreaming, 'stream' | 'model'>,
  label: string,
): Promise<StepResult> {
  captureLabel = label;
  const started = performance.now();
  let ttftMs: number | undefined;
  let text = '';
  let answerSeen = false;
  const functionCalls: StepResult['functionCalls'] = [];
  const compactionStarts = new Map<number, number>();
  const compactions: StepResult['compactions'][number][] = [];
  let compactingEvents = 0;
  let fileSearchCalls = 0;
  let fileCitations = 0;
  let terminal: Extract<ResponseStreamEvent, { type: 'response.completed' | 'response.incomplete' }> | undefined;
  let responseId: string | undefined;
  try {
    const stream = await client.responses.create({ ...params, model, stream: true });
    for await (const event of stream) {
      switch (event.type) {
        case 'response.created':
          responseId = event.response.id;
          break;
        case 'response.output_text.delta':
          ttftMs ??= Math.round(performance.now() - started);
          answerSeen = true;
          text += event.delta;
          break;
        case 'response.output_text.annotation.added':
          if ((event.annotation as { type?: string }).type === 'file_citation') fileCitations += 1;
          break;
        case 'response.output_item.added':
          if (event.item.type === 'compaction') compactionStarts.set(event.output_index, performance.now());
          break;
        case 'response.output_item.done': {
          const item = event.item;
          if (item.type === 'function_call') {
            functionCalls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments });
          } else if (item.type === 'file_search_call') {
            fileSearchCalls += 1;
          } else if (item.type === 'compaction') {
            const start = compactionStarts.get(event.output_index);
            compactions.push({
              outputIndex: event.output_index,
              position: answerSeen ? 'after-answer' : 'before-answer',
              ms: start === undefined ? undefined : Math.round(performance.now() - start),
              encryptedChars: item.encrypted_content.length,
            });
          }
          break;
        }
        case 'response.compaction.compacting':
          compactingEvents += 1;
          break;
        case 'response.completed':
        case 'response.incomplete':
          terminal = event;
          break;
        case 'response.failed':
          throw new Error(`response.failed: ${JSON.stringify(event.response.error)}`);
        case 'error':
          throw new Error(`stream error: ${event.code} ${event.message}`);
        default:
          break;
      }
    }
  } catch (error) {
    return {
      responseId, text, ttftMs, totalMs: Math.round(performance.now() - started), status: 'error',
      incompleteReason: undefined, usage: undefined, outputTypes: [], functionCalls, compactions,
      compactingEvents, fileSearchCalls, fileCitations, error: describeError(error),
    };
  } finally {
    captureLabel = undefined;
  }
  const usage = terminal?.response.usage;
  const t = totalsFor(model);
  t.responses += 1;
  t.fileSearchCalls += fileSearchCalls;
  if (usage) {
    t.input += usage.input_tokens;
    t.cached += usage.input_tokens_details.cached_tokens;
    t.cacheWrite += usage.input_tokens_details.cache_write_tokens ?? 0;
    t.output += usage.output_tokens;
    t.reasoning += usage.output_tokens_details.reasoning_tokens;
  }
  const outputTypes = terminal?.response.output.map((item) => item.type) ?? [];
  const hasAnswer = outputTypes.includes('message');
  return {
    responseId,
    text: text.slice(0, 160),
    ttftMs,
    totalMs: Math.round(performance.now() - started),
    status: terminal?.response.status,
    incompleteReason: terminal?.response.incomplete_details?.reason,
    usage: usage
      ? {
          input: usage.input_tokens,
          cached: usage.input_tokens_details.cached_tokens,
          cacheWrite: usage.input_tokens_details.cache_write_tokens ?? 0,
          output: usage.output_tokens,
          reasoning: usage.output_tokens_details.reasoning_tokens,
        }
      : undefined,
    outputTypes,
    functionCalls,
    compactions: compactions.map((c) => (hasAnswer ? c : { ...c, position: 'no-answer' as const })),
    compactingEvents,
    fileSearchCalls,
    fileCitations,
  };
}

// --- fixture text: support tickets from a seeded generator, ~50k tokens in total ----------------
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NAMES = ['Amelia', 'Bartek', 'Chiara', 'Dawid', 'Elif', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kasia', 'Luca', 'Maja', 'Nils', 'Olga', 'Piotr'];
const CITIES = ['Lisbon', 'Gdansk', 'Porto', 'Lyon', 'Bergen', 'Krakow', 'Turin', 'Ghent', 'Malmo', 'Leeds', 'Brno', 'Graz'];
const PRODUCTS = ['oak shelving units', 'glass storage jars', 'wool throw blankets', 'steel wall hooks', 'linen napkins', 'clay plant pots', 'bamboo cutting boards', 'cast-iron pans'];
const STATUSES = ['two days late', 'with a cracked box', 'on time but incomplete', 'at the wrong address', 'without an invoice', 'in perfect condition'];
const RESOLUTIONS = ['a 10% voucher', 'a free replacement', 'a partial refund', 'express reshipping', 'a call-back from logistics', 'a corrected invoice'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

const GATE_FACT = 'Ticket 1-120 (internal): the Bergen warehouse gate code is 7319, and it changes every March.';
function tickets(block: number, lines: number): string {
  const rand = prng(block * 7919);
  const out: string[] = [];
  for (let i = 1; i <= lines; i += 1) {
    if (block === 1 && i === 120) {
      out.push(GATE_FACT);
      continue;
    }
    out.push(
      `Ticket ${block}-${i}: ${pick(rand, NAMES)} reported that order #${Math.floor(rand() * 90_000) + 10_000} of ${Math.floor(rand() * 40) + 2} ${pick(rand, PRODUCTS)} to ${pick(rand, CITIES)} arrived ${pick(rand, STATUSES)}; agent ${pick(rand, NAMES)} offered ${pick(rand, RESOLUTIONS)} on ${pick(rand, DAYS)}.`,
    );
  }
  return out.join('\n');
}

// --- the bot: a function tool plus file_search, like a bot with tools and a knowledge base -------
const WEATHER_TOOL = {
  type: 'function',
  name: 'get_weather',
  description: 'Current weather for a city.',
  strict: true,
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
} as const satisfies Tool;
const STATION_CODES: Record<string, string> = { warsaw: 'WAW-ZEBRA-9', krakow: 'KRK-OTTER-4' };
function weather(args: string): string {
  const city = (JSON.parse(args) as { city: string }).city.toLowerCase();
  const key = Object.keys(STATION_CODES).find((name) => city.includes(name));
  return JSON.stringify(
    key === 'warsaw'
      ? { tempC: 12, sky: 'cloudy', stationCode: STATION_CODES['warsaw'] }
      : key === 'krakow'
        ? { tempC: 9, sky: 'rain', stationCode: STATION_CODES['krakow'] }
        : { tempC: 15, sky: 'clear', stationCode: 'UNKNOWN' },
  );
}

const INSTRUCTIONS =
  'You are the support assistant of a home-goods shop. Be brief. Use get_weather for weather questions and ' +
  'file_search for questions about the team handbook, and cite the handbook when you use it.';

interface Scenario {
  readonly name: string;
  readonly model: Model;
  readonly maxOutputTokens: number;
  readonly compaction: boolean;
  /** How many compactions to drive (1 or 2). The control drives a fixed number of filler turns. */
  readonly cycles: number;
  /** Retry a step whose response holds only compaction items (the fix S5 proposed). */
  readonly retryCompactionOnly: boolean;
  readonly controlFillerTurns?: number;
}

interface TurnRecord {
  readonly turn: string;
  readonly predictedInput: number;
  readonly steps: (StepResult & { step: number; retry?: boolean })[];
  readonly endedWith: string;
  readonly answer: string;
  readonly checks?: Record<string, boolean>;
}

async function runScenario(scenario: Scenario, vectorStoreId: string, linesPerBlock: number, charsPerToken: number): Promise<Record<string, unknown>> {
  const conversation = await client.conversations.create({
    metadata: { askdare_bot: 'spike-s5b', askdare_visitor: scenario.name },
  });
  cleanup.conversations.add(conversation.id);
  const tools: Tool[] = [WEATHER_TOOL, { type: 'file_search', vector_store_ids: [vectorStoreId], max_num_results: 3 }];
  const base = {
    instructions: INSTRUCTIONS,
    conversation: conversation.id,
    store: true,
    truncation: 'auto',
    max_output_tokens: scenario.maxOutputTokens,
    safety_identifier: SAFETY_ID,
    prompt_cache_key: `askdare:spike-s5b-${scenario.name}`,
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: true,
    include: ['file_search_call.results'],
    ...(scenario.compaction ? { context_management: [{ type: 'compaction', compact_threshold: THRESHOLD }] } : {}),
  } satisfies Omit<ResponseCreateParamsStreaming, 'stream' | 'model' | 'input'>;

  const turns: TurnRecord[] = [];
  let compactionsSeen = 0;
  // Not responses.inputTokens.count({ conversation }): it locks the conversation for over 75 s
  // (probe-lock.ts). The prediction is the last step's input + output plus the new message.
  let lastRendered = 0;
  const predict = (messageTokens: number): number => lastRendered + messageTokens;

  /** One visitor turn, run like runTurn(): steps until the model stops calling tools. */
  const turn = async (name: string, message: string, checks?: (answer: string) => Record<string, boolean>): Promise<TurnRecord> => {
    const predictedInput = predict(Math.ceil(message.length / charsPerToken));
    let input: ResponseInputItem[] = [{ role: 'user', content: message }];
    const steps: TurnRecord['steps'] = [];
    let endedWith = 'max_steps';
    let answer = '';
    let retried = false;
    for (let step = 1; step <= MAX_STEPS; step += 1) {
      let result = await streamStep(scenario.model, { ...base, input }, `${scenario.name}-${name}-step${step}`);
      for (let wait = 1; wait <= 3 && result.error?.['code'] === 'conversation_locked'; wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000 * wait));
        result = await streamStep(scenario.model, { ...base, input }, `${scenario.name}-${name}-step${step}`);
      }
      if (result.usage) lastRendered = result.usage.input + result.usage.output;
      steps.push({ step, ...result, ...(retried ? { retry: true } : {}) });
      compactionsSeen += result.compactions.length;
      answer += result.text;
      if (result.error) {
        endedWith = 'error';
        break;
      }
      const compactionOnly =
        result.compactions.length > 0 && result.functionCalls.length === 0 && !result.outputTypes.includes('message');
      if (compactionOnly && scenario.retryCompactionOnly && !retried) {
        // The user message is already stored with the compaction item, so the retry sends no new input.
        retried = true;
        input = [];
        continue;
      }
      retried = false;
      if (result.functionCalls.length === 0) {
        endedWith = result.status === 'incomplete' ? `incomplete:${result.incompleteReason}` : (result.status ?? 'unknown');
        break;
      }
      input = result.functionCalls.map((call) => ({ type: 'function_call_output', call_id: call.call_id, output: weather(call.arguments) }));
    }
    const record: TurnRecord = { turn: name, predictedInput, steps, endedWith, answer, ...(checks ? { checks: checks(answer) } : {}) };
    turns.push(record);
    const usage = steps.map((s) => s.usage ? `${s.usage.input}/${s.usage.output}` : s.status).join(' ');
    const comp = steps.flatMap((s) => s.compactions.map((c) => `${c.position}:${c.ms}ms`)).join(',');
    console.log(`  ${scenario.name} ${name}: predicted ${predictedInput}, usage in/out ${usage}, ${endedWith}${comp ? `, compaction ${comp}` : ''}`);
    return record;
  };

  // Turn 1: facts and a function call whose output must survive compaction.
  await turn('t1-facts-tool', 'Hi, I am Ola. Please remember my code word: PAPAYA-42. What is the weather in Warsaw right now?');
  // Turn 2: a cited knowledge-base answer before any compaction.
  await turn('t2-kb-before', 'According to the team handbook, what is the office dog called?', (a) => ({ pixel: /pixel/i.test(a) }));

  // Filler turns until the threshold is crossed (or the control's fixed number).
  let block = 0;
  const fillerUntilCompaction = async (cycle: number): Promise<void> => {
    const target = compactionsSeen + 1;
    for (let i = 0; i < 8; i += 1) {
      if (scenario.compaction ? compactionsSeen >= target : i >= (scenario.controlFillerTurns ?? 5)) return;
      block += 1;
      const body = tickets(block, linesPerBlock);
      const predicted = predict(FILLER_TOKENS);
      // The turn expected to cross the threshold also calls a tool, as in S5.
      const crossing = cycle === 1 && predicted + FILLER_TOKENS * 0.3 >= THRESHOLD && !turns.some((t) => t.turn.includes('crossing'));
      const ask = crossing ? 'Reply "noted", then tell me the weather in Krakow.' : 'Reply with the single word "noted".';
      await turn(`c${cycle}-filler-${block}${crossing ? '-crossing' : ''}`, `Here is the next batch of support tickets.\n${body}\n${ask}`);
    }
  };

  await fillerUntilCompaction(1);
  // After compaction: recall, the tool output, a detail from the middle of the history, citations.
  await turn('r1-code-word', 'What is my name and my code word? Answer in one line.', (a) => ({ name: /ola/i.test(a), codeWord: a.includes('PAPAYA-42') }));
  await turn('r2-tool-output', 'Which station code did the weather tool report for Warsaw earlier? Answer with the code only.', (a) => ({ stationCode: a.includes('WAW-ZEBRA-9') }));
  await turn('r3-detail', 'From the support tickets: what is the Bergen warehouse gate code? Answer with the number only.', (a) => ({ gateCode: a.includes('7319') }));
  await turn('r4-kb-after', 'According to the team handbook, when is the coffee machine cleaned?', (a) => ({ wednesday: /wednesday/i.test(a) }));
  for (const n of [1, 2, 3]) await turn(`s${n}-small`, 'Say "ok".');

  if (scenario.cycles > 1) {
    await fillerUntilCompaction(2);
    await turn('r5-code-word-after-2nd', 'What is my code word? Answer with the code word only.', (a) => ({ codeWord: a.includes('PAPAYA-42') }));
    await turn('r6-tool-after-2nd', 'Which station code did the weather tool report for Warsaw? Code only.', (a) => ({ stationCode: a.includes('WAW-ZEBRA-9') }));
  }

  const items = await client.conversations.items.list(conversation.id, { order: 'asc', limit: 100 });
  return {
    model: scenario.model,
    maxOutputTokens: scenario.maxOutputTokens,
    compaction: scenario.compaction,
    retryCompactionOnly: scenario.retryCompactionOnly,
    turns,
    items: {
      count: items.data.length,
      hasMore: items.has_more,
      types: items.data.map((item) => (item.type === 'message' ? `message:${item.role}` : item.type)),
    },
  };
}

const SCENARIOS: Scenario[] = [
  // Generous headroom first: how many output tokens does a 50k compaction really take?
  { name: 'luna-16k', model: 'gpt-6-luna', maxOutputTokens: 16_384, compaction: true, cycles: 2, retryCompactionOnly: true },
  // The library default of 1,024.
  { name: 'luna-1024', model: 'gpt-6-luna', maxOutputTokens: 1_024, compaction: true, cycles: 2, retryCompactionOnly: true },
  // Control: the same conversation without compaction (input growth, citations).
  { name: 'luna-control', model: 'gpt-6-luna', maxOutputTokens: 1_024, compaction: false, cycles: 1, retryCompactionOnly: false, controlFillerTurns: 4 },
  // The model the starter and site use, at the library default.
  { name: 'terra-1024', model: 'gpt-6.1-terra', maxOutputTokens: 1_024, compaction: true, cycles: 1, retryCompactionOnly: true },
];

async function main(): Promise<void> {
  // Calibrate the fixture text: tokens per ticket line, from the input token count endpoint.
  const sample = await client.responses.inputTokens.count({ model: 'gpt-6-luna', input: tickets(99, 100) });
  const linesPerBlock = Math.round((FILLER_TOKENS / sample.input_tokens) * 100);
  const charsPerToken = tickets(99, 100).length / sample.input_tokens;
  results['fixtureText'] = { tokensPer100Lines: sample.input_tokens, linesPerBlock, tokensPerBlock: FILLER_TOKENS };
  console.log(`fixture text: ${sample.input_tokens} tokens per 100 lines, ${linesPerBlock} lines per block`);

  const store = await client.vectorStores.create({ name: 'askdare-spike-s5b', expires_after: { anchor: 'last_active_at', days: 1 } });
  cleanup.vectorStores.add(store.id);
  const handbook = await toFile(
    Buffer.from(
      '# Team handbook\n\nThe office dog is called Pixel. Pixel visits on Fridays.\n\nThe coffee machine is cleaned every Wednesday by the facilities team.\n',
    ),
    'askdare-handbook.md',
  );
  const uploaded = await client.vectorStores.files.uploadAndPoll(store.id, handbook);
  cleanup.files.add(uploaded.id);

  const only = process.env['S5B_ONLY']?.split(',');
  for (const scenario of SCENARIOS) {
    if (only && !only.includes(scenario.name)) continue;
    if (spent(true) > BUDGET_USD) {
      results[scenario.name] = { skipped: `budget: ${spent(true).toFixed(4)} USD worst case spent` };
      continue;
    }
    console.log(`scenario ${scenario.name}`);
    const started = performance.now();
    try {
      const outcome = await runScenario(scenario, store.id, linesPerBlock, charsPerToken);
      results[scenario.name] = { ms: Math.round(performance.now() - started), ...outcome };
      console.log(`  spent so far: ${spent(false).toFixed(4)} USD (worst case ${spent(true).toFixed(4)})`);
    } catch (error) {
      results[scenario.name] = { error: describeError(error) };
      console.log(`  failed: ${describeError(error)['message']}`);
    }
  }
}

// --- redaction: stable fake ids, no encrypted blobs, never a key ---------------------------------
const ids = new Map<string, string>();
const counters = new Map<string, number>();
function redact(body: string): string {
  const withoutBlobs = body.replaceAll(/("encrypted_content":\s*)"[^"]*"/g, '$1"redacted"');
  if (/\bsk-[A-Za-z0-9_-]{20,}/.test(withoutBlobs)) throw new Error('A captured body contains something that looks like a key.');
  return withoutBlobs
    .replaceAll(/\b(org|proj)-[A-Za-z0-9]{8,}\b/g, '$1-redacted')
    .replaceAll(/\b([a-z]{2,6})_([A-Za-z0-9]{20,})\b/g, (match, prefix: string) => {
      const known = ids.get(match);
      if (known) return known;
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const fake = `${prefix}_s5b${String(n).padStart(4, '0')}`;
      ids.set(match, fake);
      return fake;
    })
    .replaceAll(/\bfile-[A-Za-z0-9]{10,}\b/g, 'file-s5bredacted')
    .replaceAll(/"safety_identifier":"[0-9a-f]{64}"/g, '"safety_identifier":"redacted"');
}

try {
  await main();
} finally {
  const cleanupReport: Record<string, unknown> = {};
  for (const id of cleanup.conversations) {
    cleanupReport[id] = await client.conversations.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  for (const id of cleanup.vectorStores) {
    cleanupReport[id] = await client.vectorStores.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  for (const id of cleanup.files) {
    cleanupReport[id] = await client.files.delete(id).then(() => 'deleted', (error: unknown) => describeError(error)['message']);
  }
  results['cleanup'] = Object.values(cleanupReport).every((outcome) => outcome === 'deleted')
    ? `${Object.keys(cleanupReport).length} of ${Object.keys(cleanupReport).length} deleted`
    : cleanupReport;
  results['tokens'] = Object.fromEntries(totals);
  results['usd'] = {
    estimated: Number(spent(false).toFixed(4)),
    worstCase: Number(spent(true).toFixed(4)),
    byModel: Object.fromEntries([...totals].map(([model, t]) => [model, Number(costUsd(model, t, false).toFixed(4))])),
  };
  results['finishedAt'] = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await writeFile(new URL('./results.json', import.meta.url), `${redact(JSON.stringify(results, null, 2))}\n`);
  await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  for (const { label, body } of captured) {
    try {
      await writeFile(new URL(`./fixtures/${label}.sse`, import.meta.url), redact(body));
    } catch (error) {
      console.log(`fixture ${label} not written: ${describeError(error)['message']}`);
    }
  }
  console.log(`\nTokens: ${JSON.stringify(Object.fromEntries(totals))}`);
  console.log(`Estimated ${spent(false).toFixed(4)} USD, worst case ${spent(true).toFixed(4)} USD. Results in results.json`);
}
