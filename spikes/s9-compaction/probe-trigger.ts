/**
 * Question 3, the documented variant: compact after the turn with `responses.create` and a
 * `{ type: 'compaction_trigger' }` input item (compaction guide, "Request compaction with an
 * explicit trigger"). It is a normal create request with the bot's tools and instructions, so it
 * should read the prompt cache the turn just wrote, which `/responses/compact` did not (it has no
 * `tools` field, so its prefix differs).
 *
 *   node --env-file=<.env.local> probe-trigger.ts <model> <history file>
 */
import { readFile, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { fromOutput, itemId, modelFamily, replay, type StoredItem } from './items.ts';
import { INSTRUCTIONS, runTurn, Spend, TOOLS, usd } from './turn.ts';
import { citations, plantedId } from './kb.ts';

const [model = 'gpt-6-luna', historyFile = 'history-luna-50.json'] = process.argv.slice(2);
const family = modelFamily(model);
const client = new OpenAI({ maxRetries: 2, timeout: 300_000 });
const spend = new Spend(Number(process.env['S9_BUDGET_USD'] ?? 0.4));
const items = JSON.parse(await readFile(new URL(`./.out/${historyFile}`, import.meta.url), 'utf8')) as StoredItem[];
const key = `askdare:spike-s9:${model}:compact-cache`;
const report: Record<string, unknown> = { model, historyFile, date: new Date().toISOString().slice(0, 10) };

const warm = await runTurn({ client, model, items, text: 'One more thing: is the Krakow showroom open on Sundays?', cacheKey: key });
spend.addSteps(model, warm.steps);
report['warmTurn'] = warm.steps.map((s) => ({ input: s.input, cached: s.cached, output: s.output }));
console.log('warm', JSON.stringify(report['warmTurn']));

const started = performance.now();
const response = await client.responses.create({
  model, instructions: INSTRUCTIONS, tools: TOOLS, store: false, // The API refuses a trigger with max_output_tokens below 20,000 (400, measured 2026-11-23).
  max_output_tokens: 20_000,
  safety_identifier: 'spike-s9-visitor', prompt_cache_key: key,
  input: [...replay(items, family), { type: 'compaction_trigger' }],
});
const ms = performance.now() - started;
const u = response.usage!;
const usage = { input: u.input_tokens, cached: u.input_tokens_details.cached_tokens, cacheWrite: u.input_tokens_details.cache_write_tokens ?? 0, output: u.output_tokens };
spend.add(model, usage);
report['trigger'] = {
  ms: Math.round(ms), ...usage, reasoning: u.output_tokens_details.reasoning_tokens, usd: Number(usd(model, usage).toFixed(5)),
  status: response.status, outputTypes: response.output.map((o) => o.type),
};
console.log('trigger', JSON.stringify(report['trigger']));
// Stored like a server-side compaction: native items; the replay starts at the compaction item.
items.push(...response.output.flatMap((o) => fromOutput(o, family) ?? []));
const compaction = items.findLast((i) => i.type === 'native' && i.kind === 'compaction');
report['windowTokens'] = compaction ? (await client.responses.inputTokens.count({ model, instructions: INSTRUCTIONS, tools: TOOLS, input: replay(items, family) })).input_tokens : null;

const after: Record<string, unknown>[] = [];
for (const text of ['Can I bring the old sofa to the showroom for recycling?', 'And what was the per-floor carrying charge again? Cite it.', 'What was my postcode and the tracking code of order 48213? Do not look it up.']) {
  const r = await runTurn({ client, model, items, text, cacheKey: key });
  spend.addSteps(model, r.steps);
  const c = citations(r.answer);
  after.push({ steps: r.steps.map((s) => ({ input: s.input, cached: s.cached, output: s.output, ttftMs: s.ttftMs === undefined ? null : Math.round(s.ttftMs) })), searched: r.searches.length, lookups: r.lookups, cited: c.ids, citesDoorway: c.ids.includes(plantedId('doorway')), answer: r.answer.slice(0, 200) });
  console.log('after', JSON.stringify(after.at(-1)));
}
report['afterCompaction'] = after;
report['spend'] = spend;
await writeFile(new URL(`./results-trigger-${model}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(spend));
void itemId;
