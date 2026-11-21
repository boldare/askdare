/**
 * Question 3 (and 2, 5): the same 20-turn conversation twice, interleaved turn by turn:
 * OpenAI Conversations (today) and stateless turns replayed from the Postgres prototype.
 *
 *   docker compose up -d --wait
 *   node --env-file=.env turns.ts            # S7_MODEL overrides the model, S7_EFFORT sets reasoning effort
 */
import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import OpenAI, { toFile } from 'openai';
import pg from 'pg';
import { openaiConversationsStore } from './openai-store.ts';
import { DATABASE_URL, migrate, postgresStore } from './pg-store.ts';
import { runTurn, type StepMetrics, type TurnMetrics } from './turn.ts';

if (!process.env['OPENAI_API_KEY']) throw new Error('Set OPENAI_API_KEY in spikes/s7-store/.env');
// Model IDs live in this spike only; the library never hardcodes one.
const MODEL = process.env['S7_MODEL'] ?? 'gpt-6.1-terra';
const EFFORT = process.env['S7_EFFORT'] as 'low' | 'medium' | undefined;
// Per 1M tokens, Standard, short context (https://developers.openai.com/api/docs/pricing, as used by S5b on 2026-11-12).
const PRICES: Record<string, { input: number; cached: number; write: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, write: 1.25, output: 5 },
};
const price = PRICES[MODEL];
if (!price) throw new Error(`no price for ${MODEL}`);
const cost = (s: StepMetrics): number =>
  ((s.input - s.cached - s.cacheWrite) * price.input + s.cached * price.cached + s.cacheWrite * price.write + s.output * price.output) / 1e6;

const SCRIPT = [
  'Hi! My name is Ola and I am planning to buy a sofa. How long does delivery usually take?',
  'Can you check my order 48213? I ordered a table last week.',
  'Here is a photo of a scratch on the table. Is that covered by the warranty?',
  'What payment methods do you accept?',
  'Could I pay with a gift card and a credit card together?',
  'And what about order 51877, is it shipped yet?',
  'Do you offer assembly for the sofa?',
  'How do I return something I do not like?',
  'How long until I get my refund after a return?',
  'Please check order 60042 as well.',
  'Is there a student discount?',
  'Can I change the delivery address for order 48213?',
  'Do you recycle old furniture when delivering new pieces?',
  'What are your store hours on Sundays?',
  'Can I get an invoice for my company?',
  'Do you deliver to Norway?',
  'How should I care for a linen sofa?',
  'What happens if an item is out of stock after I order it?',
  'Compare orders 51877 and 60042 for me: which arrives first?',
  'Before I go: what is my name, and which order had the scratched table? One sentence.',
];

/** An 8×8 red PNG, so a turn carries an image attachment (question 5). */
function tinyPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0);
  header.writeUInt32BE(8, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [200, 30, 30]).flat()])));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

const client = new OpenAI({ maxRetries: 1, timeout: 120_000 });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
await migrate(pool);
const openaiStore = openaiConversationsStore(client);
const pgStore = postgresStore(pool);
const owner = { botId: 'spike-s7', owner: 'visitor:s7-run' };
const report: Record<string, unknown> = { model: MODEL, effort: EFFORT ?? 'default', startedAt: new Date().toISOString() };
const cleanup: { conversations: string[]; files: string[]; deleted: Record<string, unknown> } = { conversations: [], files: [], deleted: {} };
const rows: { turn: number; conversation?: TurnMetrics; stateless?: TurnMetrics }[] = [];

const convId = await openaiStore.create(owner);
cleanup.conversations.push(convId);
const pgId = await pgStore.create(owner);
try {
  const file = await client.files.create({
    file: await toFile(tinyPng(), 'scratch.png', { type: 'image/png' }),
    purpose: 'user_data',
    expires_after: { anchor: 'created_at', seconds: 24 * 60 * 60 },
  });
  cleanup.files.push(file.id);
  const safetyIdentifier = 'spike-s7-visitor-hash';
  for (const [index, text] of SCRIPT.entries()) {
    const turn = index + 1;
    const fileIds = turn === 3 ? [file.id] : [];
    const row: (typeof rows)[number] = { turn };
    // Alternate which mode goes first, so a warm cache or time of day favours neither.
    const order = turn % 2 === 0 ? (['stateless', 'conversation'] as const) : (['conversation', 'stateless'] as const);
    for (const mode of order) {
      const store = mode === 'conversation' ? openaiStore : pgStore;
      const id = mode === 'conversation' ? convId : pgId;
      row[mode] = await runTurn({ client, model: MODEL, store, conversationId: id, text, fileIds, safetyIdentifier, ...(EFFORT ? { reasoning: { effort: EFFORT } } : {}) });
    }
    rows.push(row);
    const fmt = (m: TurnMetrics | undefined) =>
      m ? `${m.steps.map((s) => `${Math.round(s.ttftMs ?? -1)}ms/${s.input}in/${s.cached}c${s.transformations.length ? `/T:${s.transformations.join('+')}` : ''}`).join(' ')}` : '';
    console.log(`t${turn} conv ${fmt(row.conversation)} | stateless ${fmt(row.stateless)}`);
  }
  report['recall'] = {
    conversation: rows.at(-1)?.conversation?.answer,
    stateless: rows.at(-1)?.stateless?.answer,
  };

  // Question 2: what the stateless conversation stores, by item type.
  const sizes = await pool.query<{ type: string; kind: string | null; count: string; bytes: string; json: string }>(
    `select type, item->'data'->>'type' as kind, count(*) as count, sum(pg_column_size(item)) as bytes, sum(length(item::text)) as json
     from askdare_items where conversation_id = $1 group by 1, 2 order by 1, 2`,
    [pgId],
  );
  report['storedByType'] = sizes.rows.map((r) => ({ type: r.type, native: r.kind, count: Number(r.count), bytesOnDisk: Number(r.bytes), jsonChars: Number(r.json) }));
  const total = await pool.query<{ bytes: string }>('select sum(pg_column_size(item)) as bytes from askdare_items where conversation_id = $1', [pgId]);
  report['storedBytes'] = Number(total.rows[0]?.bytes ?? 0);

  // The OpenAI conversation, for comparison.
  const listed: string[] = [];
  const t = performance.now();
  for await (const item of client.conversations.items.list(convId, { order: 'asc', limit: 100 })) {
    listed.push(item.type === 'message' ? `message:${item.role}` : item.type);
  }
  report['openaiItemsListMs'] = Math.round(performance.now() - t);
  report['openaiItems'] = listed.reduce<Record<string, number>>((acc, type) => ({ ...acc, [type]: (acc[type] ?? 0) + 1 }), {});
  const pgT = performance.now();
  const pgPage = await pgStore.page(pgId, { limit: 100 });
  report['pgPageMs'] = Math.round(performance.now() - pgT);
  report['pgItems'] = pgPage.items.length;

  // Question 5: delete both with their files.
  const pgDeleted = await pgStore.delete(pgId);
  const convDeleted = await openaiStore.delete(convId);
  report['deleteReturnedFiles'] = { postgres: pgDeleted.fileIds, openai: convDeleted.fileIds };
} finally {
  for (const id of cleanup.conversations) {
    cleanup.deleted[id] = await client.conversations.delete(id).then(() => 'deleted', (e: unknown) => (e instanceof OpenAI.NotFoundError ? 'already gone' : String(e)));
  }
  for (const id of cleanup.files) {
    cleanup.deleted[id] = await client.files.delete(id).then(() => 'deleted', (e: unknown) => (e instanceof OpenAI.NotFoundError ? 'already gone' : String(e)));
  }
  await pgStore.delete(pgId).catch(() => undefined);
  await pool.end();

  const summary = (mode: 'conversation' | 'stateless') => {
    const turns = rows.flatMap((r) => (r[mode] ? [r[mode]] : []));
    const steps = turns.flatMap((m) => m.steps);
    const firsts = turns.map((m) => m.steps[0]?.ttftMs ?? m.steps.find((s) => s.ttftMs !== undefined)?.ttftMs).filter((v): v is number => v !== undefined);
    const ttfts = turns.map((m) => {
      let elapsed = 0;
      for (const s of m.steps) {
        if (s.ttftMs !== undefined) return elapsed + s.ttftMs;
        elapsed += s.durationMs;
      }
      return undefined;
    }).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
    const sum = (f: (s: StepMetrics) => number) => steps.reduce((acc, s) => acc + f(s), 0);
    return {
      turns: turns.length,
      steps: steps.length,
      firstTextMsMedian: Math.round(ttfts[Math.floor(ttfts.length / 2)] ?? 0),
      firstTextMsP90: Math.round(ttfts[Math.floor(ttfts.length * 0.9)] ?? 0),
      firstStepTtftMedian: Math.round(firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)] ?? 0),
      totalMsMedian: Math.round(turns.map((m) => m.totalMs).sort((a, b) => a - b)[Math.floor(turns.length / 2)] ?? 0),
      storeMsMedian: Math.round(turns.map((m) => m.contextMs + m.appendMs).sort((a, b) => a - b)[Math.floor(turns.length / 2)] ?? 0),
      input: sum((s) => s.input),
      cached: sum((s) => s.cached),
      cacheWrite: sum((s) => s.cacheWrite),
      output: sum((s) => s.output),
      reasoning: sum((s) => s.reasoning),
      transformations: steps.flatMap((s) => s.transformations),
      reasoningContexts: [...new Set(steps.map((s) => s.reasoningContext))],
      maxInputBytes: Math.max(...steps.map((s) => s.inputBytes)),
      usd: Number(sum(cost).toFixed(4)),
    };
  };
  report['summary'] = { conversation: summary('conversation'), stateless: summary('stateless') };
  report['turns'] = rows.map((r) => ({
    turn: r.turn,
    conversation: r.conversation && { ...r.conversation, answer: r.conversation.answer.slice(0, 160) },
    stateless: r.stateless && { ...r.stateless, answer: r.stateless.answer.slice(0, 160) },
  }));
  report['cleanup'] = cleanup.deleted;
  const out = `results-turns-${MODEL}${EFFORT ? `-${EFFORT}` : ''}.json`;
  await writeFile(new URL(`./${out}`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ summary: report['summary'], recall: report['recall'], cleanup: cleanup.deleted, storedBytes: report['storedBytes'] }, null, 2));
}
