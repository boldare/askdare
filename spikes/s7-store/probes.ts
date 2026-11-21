/**
 * Small probes for questions 1, 3, 4, 6 and 7.
 *
 *   node --env-file=.env probes.ts [p1 p2 p3 p4 p5]
 *
 * p1 dangling call replayed statelessly; p2 crash between a step and its append; p3 encrypted
 * reasoning replay (ids, other end user, other model family); p4 paging an OpenAI conversation
 * beyond 100 items; p5 stream resume buffer in Postgres (local only).
 */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import pg from 'pg';
import { itemId, modelFamily, replay } from './openai-map.ts';
import { DATABASE_URL, migrate, postgresStore } from './pg-store.ts';
import { INSTRUCTIONS, runTurn } from './turn.ts';

const MODEL = process.env['S7_MODEL'] ?? 'gpt-6.1-terra';
const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['p1', 'p2', 'p3', 'p4', 'p5']);
const client = new OpenAI({ maxRetries: 1, timeout: 120_000 });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
await migrate(pool);
const store = postgresStore(pool);
const owner = { botId: 'spike-s7', owner: 'visitor:s7-probes' };
const results: Record<string, unknown> = { model: MODEL };
const created: string[] = [];
const usage = { input: 0, cached: 0, output: 0 };
const track = (response: OpenAI.Responses.Response) => {
  usage.input += response.usage?.input_tokens ?? 0;
  usage.cached += response.usage?.input_tokens_details.cached_tokens ?? 0;
  usage.output += response.usage?.output_tokens ?? 0;
};
const base = { model: MODEL, instructions: INSTRUCTIONS, store: false, max_output_tokens: 1_024, prompt_cache_key: 'askdare:spike-s7' } as const;

try {
  if (which.has('p1')) {
    // Question 1: what a store that saved a call without its output does to the next turn.
    const dangling: ResponseInputItem[] = [
      { role: 'user', content: 'Check order 48213.' },
      { type: 'function_call', call_id: 'call_s7_dangling', name: 'lookup_order', arguments: '{"order_id":"48213"}' },
      { role: 'user', content: 'Hello?' },
    ];
    const tools = [{ type: 'function' as const, name: 'lookup_order', strict: true, parameters: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'], additionalProperties: false } }];
    const p1: Record<string, unknown> = {};
    try {
      const r = await client.responses.create({ ...base, input: dangling, tools, safety_identifier: 's7-probe' });
      track(r);
      p1['dangling'] = { ok: true, text: r.output_text.slice(0, 120) };
    } catch (error) {
      p1['dangling'] = { ok: false, status: (error as { status?: number }).status, message: String((error as Error).message).slice(0, 240) };
    }
    const repaired: ResponseInputItem[] = [dangling[0]!, dangling[1]!, { type: 'function_call_output', call_id: 'call_s7_dangling', output: '{"error":"The previous request was interrupted."}' }, dangling[2]!];
    const r = await client.responses.create({ ...base, input: repaired, tools, safety_identifier: 's7-probe' });
    track(r);
    p1['repaired'] = { ok: true, outputTypes: r.output.map((o) => o.type) };
    results['p1'] = p1;
    console.log('p1', JSON.stringify(p1));
  }

  if (which.has('p2')) {
    // Question 1: a server that dies after a step's model call and before its append.
    const id = await store.create(owner);
    const p2: Record<string, unknown> = {};
    try {
      await runTurn({ client, model: MODEL, store, conversationId: id, text: 'Where is my order 48213?', safetyIdentifier: 's7-probe', crashAfterStep: 1 });
    } catch (error) {
      p2['crash'] = String((error as Error).message);
    }
    p2['storedAfterCrash'] = (await store.page(id)).items.map((item) => (item.type === 'message' ? `message:${item.role}` : item.type));
    const next = await runTurn({ client, model: MODEL, store, conversationId: id, text: 'Hello? Did you find it?', safetyIdentifier: 's7-probe' });
    p2['nextTurn'] = { steps: next.steps.length, outputTypes: next.steps.map((s) => s.outputTypes), answer: next.answer.slice(0, 160) };
    p2['storedAfterNext'] = (await store.page(id)).items.map((item) => (item.type === 'message' ? `message:${item.role}` : item.type));
    await store.delete(id);
    results['p2'] = p2;
    console.log('p2', JSON.stringify(p2));
  }

  if (which.has('p3')) {
    // Questions 3 and 4: encrypted reasoning in replay. Needs reasoning output, so effort low.
    const effort = (process.env['S7_EFFORT'] ?? 'low') as 'low';
    const id = await store.create(owner);
    const p3: Record<string, unknown> = { effort };
    const t1 = await runTurn({ client, model: MODEL, store, conversationId: id, text: 'Check order 48213 and tell me if it is delayed.', safetyIdentifier: 's7-probe-a', reasoning: { effort } });
    p3['turn1'] = t1.steps.map((s) => ({ outputTypes: s.outputTypes, reasoning: s.reasoning, transformations: s.transformations, context: s.reasoningContext }));
    const context = await store.context(id);
    if (context.kind !== 'items') throw new Error('expected items');
    const nativeItems = context.items.filter((item) => item.type === 'native');
    p3['nativeStored'] = nativeItems.map((item) => {
      const data = item.type === 'native' ? (item.data as { type?: string; encrypted_content?: string; id?: string }) : {};
      return { type: data.type, hasEncrypted: typeof data.encrypted_content === 'string', encryptedChars: data.encrypted_content?.length ?? 0, hasId: Boolean(data.id) };
    });
    const question: ResponseInputItem = { role: 'user', content: 'Thanks. And when will it arrive?' };
    const variant = async (label: string, input: ResponseInputItem[], extra: Record<string, unknown> = {}) => {
      try {
        const r = await client.responses.create({ ...base, input, safety_identifier: 's7-probe-a', reasoning: { effort }, ...extra });
        track(r);
        p3[label] = {
          input: r.usage?.input_tokens,
          cached: r.usage?.input_tokens_details.cached_tokens,
          transformations: (r.input_transformations ?? []).map((t) => t.reason),
          context: (r.reasoning as { context?: string } | null)?.context,
        };
      } catch (error) {
        p3[label] = { error: String((error as Error).message).slice(0, 240) };
      }
    };
    const family = modelFamily(MODEL);
    await variant('replayWithIds', [...replay(context.items, family), question]);
    await variant('replayWithoutReasoningIds', [...replay(context.items, family, { keepReasoningIds: false }), question]);
    await variant('otherEndUser', [...replay(context.items, family), question], { safety_identifier: 's7-probe-b' });
    await variant('reasoningDropped', [...replay(context.items, 'other-family'), question]);
    await variant('allTurns', [...replay(context.items, family), question], { reasoning: { effort, context: 'all_turns' } });
    await store.delete(id);
    results['p3'] = p3;
    console.log('p3', JSON.stringify(p3));
  }

  if (which.has('p4')) {
    // Question 7: history beyond the latest 100 items at OpenAI (no model calls).
    const conversation = await client.conversations.create({ metadata: { askdare_bot: 'spike-s7', askdare_owner: 'visitor:s7-paging' } });
    created.push(conversation.id);
    const items: ResponseInputItem[] = [];
    for (let n = 1; n <= 70; n += 1) {
      items.push({ role: 'user', content: `Question ${n}` }, { role: 'assistant', content: `Answer ${n}` });
    }
    let t = performance.now();
    for (let index = 0; index < items.length; index += 20) await client.conversations.items.create(conversation.id, { items: items.slice(index, index + 20) });
    const createMs = performance.now() - t;
    const pages: { count: number; ms: number; hasMore: boolean }[] = [];
    let after: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      t = performance.now();
      const result = await client.conversations.items.list(conversation.id, { order: 'desc', limit: 100, ...(after ? { after } : {}) });
      pages.push({ count: result.data.length, ms: Math.round(performance.now() - t), hasMore: result.has_more });
      const last = result.data.at(-1);
      after = last && 'id' in last && typeof last.id === 'string' ? last.id : undefined;
      if (!result.has_more) break;
    }
    // The same in Postgres.
    const id = await store.create(owner);
    for (let index = 0; index < items.length; index += 20) {
      await store.append(id, items.slice(index, index + 20).map((item) => {
        const message = item as { role: 'user' | 'assistant'; content: string };
        return { id: itemId(), type: 'message', role: message.role, parts: [{ type: 'text', text: message.content }] };
      }));
    }
    const pgPages: { count: number; ms: number }[] = [];
    let before: string | undefined;
    do {
      t = performance.now();
      const page = await store.page(id, { limit: 100, ...(before ? { before } : {}) });
      pgPages.push({ count: page.items.length, ms: Number((performance.now() - t).toFixed(1)) });
      before = page.before;
    } while (before);
    await store.delete(id);
    results['p4'] = { items: items.length, openaiCreateMs: Math.round(createMs), openaiPages: pages, pgPages };
    console.log('p4', JSON.stringify(results['p4']));
  }

  if (which.has('p5')) {
    // Question 6: a resume buffer for a turn's protocol events in Postgres (local only).
    const deltas = 400; // A long answer streams a few hundred text deltas.
    const ttl = "now() + interval '5 minutes'";
    const perEvent = randomUUID();
    let t = performance.now();
    for (let seq = 1; seq <= deltas; seq += 1) {
      await pool.query(`insert into askdare_turn_events (turn_id, seq, event, expires_at) values ($1, $2, $3, ${ttl})`, [perEvent, seq, JSON.stringify({ type: 'text.delta', delta: 'word ' })]);
    }
    const perEventMs = performance.now() - t;
    // Batched every 100 ms or 20 events, as a writer would flush.
    const batched = randomUUID();
    t = performance.now();
    let flushes = 0;
    for (let seq = 1; seq <= deltas; seq += 20) {
      const batch = Array.from({ length: Math.min(20, deltas - seq + 1) }, (_, i) => ({ seq: seq + i, event: { type: 'text.delta', delta: 'word ' } }));
      await pool.query(`insert into askdare_turn_events (turn_id, seq, event, expires_at) select $1, (x->>'seq')::int, x->'event', ${ttl} from jsonb_array_elements($2::jsonb) x`, [batched, JSON.stringify(batch)]);
      flushes += 1;
    }
    const batchedMs = performance.now() - t;
    // Resume: everything after the last event the client saw, then wait for more with LISTEN.
    t = performance.now();
    const resumed = await pool.query('select seq, event from askdare_turn_events where turn_id = $1 and seq > $2 order by seq', [batched, 250]);
    const resumeMs = performance.now() - t;
    const listener = await pool.connect();
    await listener.query('listen askdare_turn');
    const notified = new Promise<number>((resolve) => {
      const start = performance.now();
      listener.on('notification', () => resolve(performance.now() - start));
    });
    await pool.query("select pg_notify('askdare_turn', $1)", [batched]);
    const notifyMs = await notified;
    await listener.query('unlisten askdare_turn');
    listener.release();
    const sweep = await pool.query('delete from askdare_turn_events where turn_id = any($1::uuid[])', [[perEvent, batched]]);
    results['p5'] = {
      deltas,
      perEventInsertMs: Math.round(perEventMs),
      perEventAvgMs: Number((perEventMs / deltas).toFixed(2)),
      batchedMs: Math.round(batchedMs),
      flushes,
      resumeReadMs: Number(resumeMs.toFixed(1)),
      resumedEvents: resumed.rowCount,
      notifyMs: Number(notifyMs.toFixed(1)),
      sweptRows: sweep.rowCount,
    };
    console.log('p5', JSON.stringify(results['p5']));
  }
} finally {
  const deleted: Record<string, string> = {};
  for (const id of created) deleted[id] = await client.conversations.delete(id).then(() => 'deleted', (e: unknown) => String(e));
  results['cleanup'] = deleted;
  // terra prices per 1M: input 1, cached 0.05, output 5 (worst case: uncached = input - cached).
  results['usage'] = { ...usage, usdApprox: Number((((usage.input - usage.cached) * 1 + usage.cached * 0.05 + usage.output * 5) / 1e6).toFixed(4)) };
  await pool.end();
  const out = new URL(`./results-probes-${[...which].join('-')}.json`, import.meta.url);
  await writeFile(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ cleanup: deleted, usage: results['usage'] }));
}
