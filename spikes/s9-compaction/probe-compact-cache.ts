/**
 * Question 3, follow-up: `arms.ts` called `/responses/compact` with a cold cache (0 of 80.6k input
 * tokens cached, 0.085 USD on terra). In `waitUntil` the compaction would run right after a turn
 * that just cached the same prefix. Does the compact endpoint read that cache?
 *
 * 1. A normal turn on the 50-turn history with prompt_cache_key K (warms the cache).
 * 2. `/responses/compact` on the same items (+ that turn) with K. Cached tokens?
 * 3. The same compact call again, unchanged. Cached tokens? Same output?
 * 4. Two turns on the compacted window: what the next turns cache.
 *
 *   node --env-file=<.env.local> probe-compact-cache.ts gpt-6.1-terra history-terra-50.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { itemId, modelFamily, replay, type StoredItem } from './items.ts';
import { INSTRUCTIONS, runTurn, Spend, TOOLS, usd } from './turn.ts';

const [model = 'gpt-6.1-terra', historyFile = 'history-terra-50.json'] = process.argv.slice(2);
const family = modelFamily(model);
const client = new OpenAI({ maxRetries: 2, timeout: 300_000 });
const spend = new Spend(Number(process.env['S9_BUDGET_USD'] ?? 0.5));
const items = JSON.parse(await readFile(new URL(`./.out/${historyFile}`, import.meta.url), 'utf8')) as StoredItem[];
const key = `askdare:spike-s9:${model}:compact-cache`;
const report: Record<string, unknown> = { model, historyFile, date: new Date().toISOString().slice(0, 10) };

const warm = await runTurn({ client, model, items, text: 'One more thing: is the Krakow showroom open on Sundays?', cacheKey: key });
spend.addSteps(model, warm.steps);
report['warmTurn'] = warm.steps.map((s) => ({ input: s.input, cached: s.cached, output: s.output }));
console.log('warm', JSON.stringify(report['warmTurn']));

const input = replay(items, family);
const compactRuns: Record<string, unknown>[] = [];
let lastOutput: ResponseInputItem[] = [];
// With S9_COMPACT_TOOLS=1 the first call also sends `tools` (not in the endpoint's schema, but
// accepted): does it then render the same prefix as the turns and read their cache?
const withTools = process.env['S9_COMPACT_TOOLS'] === '1';
const labels = withTools ? ['after-turn-with-tools', 'without-tools', 'repeat-without-tools'] : ['after-turn', 'repeat'];
report['withTools'] = withTools;
for (const label of labels) {
  const started = performance.now();
  const compacted = await client.responses.compact({ model, instructions: INSTRUCTIONS, input, prompt_cache_key: key, ...(label.endsWith('with-tools') ? ({ tools: TOOLS } as object) : {}) });
  const ms = performance.now() - started;
  const u = compacted.usage;
  const usage = { input: u.input_tokens, cached: u.input_tokens_details.cached_tokens, cacheWrite: u.input_tokens_details.cache_write_tokens ?? 0, output: u.output_tokens };
  spend.add(model, usage);
  lastOutput = compacted.output.map((o) => JSON.parse(JSON.stringify(o)) as ResponseInputItem);
  compactRuns.push({ label, ms: Math.round(ms), ...usage, reasoning: u.output_tokens_details.reasoning_tokens, usd: Number(usd(model, usage).toFixed(5)), items: compacted.output.length });
  console.log('compact', JSON.stringify(compactRuns.at(-1)));
}
report['compact'] = compactRuns;

// Does the compact endpoint accept a request that also names the tools? (It has no `tools` field.)
try {
  await client.responses.compact({ model, instructions: INSTRUCTIONS, input: input.slice(0, 4), prompt_cache_key: key, ...({ tools: TOOLS } as object) });
  report['toolsField'] = 'accepted';
} catch (error) {
  report['toolsField'] = error instanceof OpenAI.APIError ? `${error.status} ${error.message.slice(0, 160)}` : String(error);
}

items.push({ id: itemId(), type: 'native', provider: 'openai', family, kind: 'compacted_window', data: lastOutput });
const after: Record<string, unknown>[] = [];
for (const text of ['Can I bring the old sofa to the showroom for recycling?', 'And what was the per-floor carrying charge again? Cite it.']) {
  const r = await runTurn({ client, model, items, text, cacheKey: key });
  spend.addSteps(model, r.steps);
  after.push({ steps: r.steps.map((s) => ({ input: s.input, cached: s.cached, output: s.output, ttftMs: s.ttftMs === undefined ? null : Math.round(s.ttftMs) })), searched: r.searches.length, answer: r.answer.slice(0, 200) });
  console.log('after', JSON.stringify(after.at(-1)));
}
report['afterCompaction'] = after;
report['spend'] = spend;
await writeFile(new URL(`./results-compact-cache-${model}${withTools ? '-tools' : ''}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(spend));
