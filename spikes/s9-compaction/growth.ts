/**
 * Question 1: how large does a realistic askdare conversation get at `limits.maxTurns` = 50, and
 * what does each turn cost and take as it grows? Runs SCRIPT statelessly (store: false), no
 * compaction, and keeps the stored items in `.out/` (git-ignored: it holds encrypted reasoning)
 * so the compaction arms can branch from the same history.
 *
 *   node --env-file=<path to .env.local> growth.ts gpt-6-luna
 */
import { mkdir, writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { describe, type StoredItem } from './items.ts';
import { SCRIPT } from './script.ts';
import { runTurn, Spend, usd, type TurnResult } from './turn.ts';

const model = process.argv[2] ?? 'gpt-6-luna';
const turns = Number(process.argv[3] ?? SCRIPT.length);
/** Optional: server-side compaction on every turn at this threshold (question 2, saw-tooth). */
const threshold = Number(process.env['S9_THRESHOLD'] ?? 0);
const tag = threshold ? `${model}-t${threshold}` : model;
const client = new OpenAI({ maxRetries: 2, timeout: 180_000 });
const spend = new Spend(Number(process.env['S9_BUDGET_USD'] ?? 1));
const items: StoredItem[] = [];
const rows: Record<string, unknown>[] = [];
await mkdir(new URL('./.out/', import.meta.url), { recursive: true });

try {
  for (let i = 0; i < turns; i += 1) {
    const text = SCRIPT[i % SCRIPT.length]!;
    const result: TurnResult = await runTurn({ client, model, items, text, cacheKey: `askdare:spike-s9:${model}:growth`, ...(threshold ? { compactThreshold: threshold } : {}) });
    spend.addSteps(model, result.steps);
    const first = result.steps[0]!;
    const last = result.steps.at(-1)!;
    const turnUsage = result.steps.reduce((u, s) => ({ input: u.input + s.input, cached: u.cached + s.cached, cacheWrite: u.cacheWrite + s.cacheWrite, output: u.output + s.output }), { input: 0, cached: 0, cacheWrite: 0, output: 0 });
    const row = {
      turn: i + 1,
      steps: result.steps.length,
      searches: result.searches.length,
      lookups: result.lookups,
      firstStepInput: first.input,
      lastStepInput: last.input,
      turnInput: turnUsage.input,
      turnCached: turnUsage.cached,
      turnOutput: turnUsage.output,
      ttftMs: Math.round(result.steps.find((s) => s.ttftMs !== undefined)?.ttftMs ?? NaN) + Math.round(result.steps.slice(0, result.steps.findIndex((s) => s.ttftMs !== undefined)).reduce((sum, s) => sum + s.durationMs, 0)),
      firstStepTtftMs: first.ttftMs === undefined ? null : Math.round(first.ttftMs),
      totalMs: Math.round(result.totalMs),
      usd: Number(usd(model, turnUsage).toFixed(5)),
      storedItems: items.length,
      storedBytes: JSON.stringify(items).length,
      answerChars: result.answer.length,
      compactions: result.steps.reduce((n, s) => n + s.outputTypes.filter((t) => t === 'compaction').length, 0),
      maxStepOutput: Math.max(...result.steps.map((s) => s.output)),
      incomplete: result.steps.filter((s) => s.status !== 'completed').length,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    spend.check();
  }
} finally {
  const cumulative = rows.reduce<number[]>((acc, r) => [...acc, (acc.at(-1) ?? 0) + (r['turnInput'] as number) + (r['turnOutput'] as number)], []);
  await writeFile(new URL(`./.out/history-${tag}.json`, import.meta.url), JSON.stringify(items));
  await writeFile(new URL(`./results-growth-${tag}.json`, import.meta.url), `${JSON.stringify({
    model,
    threshold,
    date: new Date().toISOString().slice(0, 10),
    turns: rows.length,
    stored: describe(items),
    storedBytes: JSON.stringify(items).length,
    // What limits.ts charges against dailyTokens / dailyTokensPerIp: input + output, cached included.
    cumulativeBudgetTokens: cumulative,
    spend,
    rows,
  }, null, 2)}\n`);
  console.log(JSON.stringify(spend));
}
