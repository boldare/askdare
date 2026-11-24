/**
 * One stateless chat turn the way ADR-0024 runs it with an item store (copied from S7's `turn.ts`):
 * `store: false`, the stored window replayed, every output item appended. The bot has ADR-0025's
 * `search_knowledge` tool (stable `[k…]` IDs) and S7's `lookup_order`. Optional:
 * `context_management` for server-side compaction (question 2).
 */
import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import { RETRIEVAL_RULES, search, wrapPassages } from './kb.ts';
import { fromOutput, itemId, modelFamily, replay, type StoredItem } from './items.ts';

/** S7's instructions (above the cache minimum) plus ADR-0025's retrieval rules. */
export const INSTRUCTIONS = (() => {
  const topics = ['delivery times', 'returns', 'warranty', 'payment methods', 'gift cards', 'assembly service', 'damaged items', 'order changes', 'invoices', 'store hours', 'loyalty points', 'price matching', 'custom furniture', 'bulk orders', 'international shipping', 'product care', 'out-of-stock items', 'pre-orders', 'cancellations', 'refund timing', 'click and collect', 'installation', 'recycling old furniture', 'student discount', 'accessibility support'];
  const lines = topics.map((topic, index) => `${index + 1}. ${topic[0]!.toUpperCase()}${topic.slice(1)}: answer from the help centre (search_knowledge) for ${topic}, and offer to look up the visitor's order with lookup_order when the question concerns a specific order. Never promise exceptions to the ${topic} policy; a human agent decides those within two working days.`);
  return [
    'You are the support assistant of Northwind Home, an online shop for furniture and home goods.',
    'Answer briefly (at most three sentences), politely and in the language the visitor writes in.',
    'Search the help centre with search_knowledge before answering any question about policies, prices or services, unless the answer is already in this conversation.',
    'If you do not know something, say so and suggest contacting support@northwind.example.',
    'Use lookup_order whenever the visitor mentions an order number. Do not invent order data.',
    RETRIEVAL_RULES,
    'Policies by topic:',
    ...lines,
  ].join('\n');
})();

export const TOOLS: OpenAI.Responses.FunctionTool[] = [
  {
    type: 'function', name: 'lookup_order', strict: true,
    description: 'Looks up an order by its number and returns its status, items and delivery estimate.',
    parameters: { type: 'object', properties: { order_id: { type: 'string', description: 'The order number, digits only.' } }, required: ['order_id'], additionalProperties: false },
  },
  {
    type: 'function', name: 'search_knowledge', strict: true,
    description: 'Searches the Northwind Home help centre. Returns up to 5 passages, each with an id to cite.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for, in English.' } }, required: ['query'], additionalProperties: false },
  },
];

export function lookupOrder(args: string): string {
  let orderId = '';
  try {
    orderId = String((JSON.parse(args) as { order_id?: unknown }).order_id ?? '');
  } catch { /* strict tools always send JSON */ }
  const n = Number.parseInt(orderId.replace(/\D/g, '').slice(-4) || '0', 10);
  return JSON.stringify({
    order_id: orderId,
    status: ['processing', 'shipped', 'delivered', 'delayed'][n % 4],
    items: [
      { sku: `NW-${1000 + (n % 97)}`, name: ['Oak dining table', 'Linen sofa', 'Wool rug', 'Desk lamp'][n % 4], quantity: 1 + (n % 3) },
      { sku: `NW-${2000 + (n % 89)}`, name: 'Felt chair pads (4)', quantity: 1 },
    ],
    estimated_delivery: `2026-12-${String(1 + (n % 27)).padStart(2, '0')}`,
    carrier: ['DPD', 'InPost', 'DHL'][n % 3],
    tracking_code: `NWT-${(n * 7919) % 100_000}`,
  });
}

function runTool(name: string, args: string, searches: string[][]): string {
  if (name === 'lookup_order') return lookupOrder(args);
  const query = String((JSON.parse(args) as { query?: unknown }).query ?? '');
  const results = search(query);
  searches.push(results.map((p) => p.sourceId));
  return wrapPassages(results);
}

export interface StepMetrics {
  readonly ttftMs: number | undefined;
  readonly durationMs: number;
  readonly input: number;
  readonly cached: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly status: string;
  readonly outputTypes: readonly string[];
  /** Compaction passes in this step: ms from `output_item.added` to `.done`. */
  readonly compactionMs: readonly number[];
  readonly replayedItems: number;
  readonly inputBytes: number;
}

export interface TurnResult {
  readonly steps: readonly StepMetrics[];
  readonly totalMs: number;
  readonly answer: string;
  readonly searches: readonly (readonly string[])[];
  readonly lookups: number;
}

export interface TurnOptions {
  readonly client: OpenAI;
  readonly model: string;
  /** The conversation's stored items; the turn appends to it, like an item store. */
  readonly items: StoredItem[];
  readonly text: string;
  readonly maxSteps?: number;
  readonly maxOutputTokens?: number;
  readonly compactThreshold?: number;
  readonly cacheKey: string;
}

export async function runTurn(options: TurnOptions): Promise<TurnResult> {
  const { client, model, items } = options;
  const family = modelFamily(model);
  const started = performance.now();
  items.push({ id: itemId(), type: 'message', role: 'user', text: options.text });
  const maxSteps = options.maxSteps ?? 5;
  const steps: StepMetrics[] = [];
  const searches: string[][] = [];
  let lookups = 0;
  let answer = '';
  for (let step = 1; step <= maxSteps; step += 1) {
    const input: ResponseInputItem[] = replay(items, family);
    const stepStart = performance.now();
    let ttft: number | undefined;
    const compactionStarted = new Map<number, number>();
    const compactionMs: number[] = [];
    const stream = await client.responses.create({
      model,
      instructions: INSTRUCTIONS,
      input,
      store: false,
      stream: true,
      // Compaction counts against max_output_tokens (S5); S5b's +1,024 headroom when it may run.
      max_output_tokens: (options.maxOutputTokens ?? 1_024) + (options.compactThreshold ? 1_024 : 0),
      safety_identifier: 'spike-s9-visitor',
      prompt_cache_key: options.cacheKey,
      tools: TOOLS,
      tool_choice: step === maxSteps ? 'none' : 'auto',
      parallel_tool_calls: true,
      ...(options.compactThreshold ? { context_management: [{ type: 'compaction' as const, compact_threshold: options.compactThreshold }] } : {}),
    });
    let response: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta' && ttft === undefined) ttft = performance.now() - stepStart;
      if (event.type === 'response.output_item.added' && event.item.type === 'compaction') compactionStarted.set(event.output_index, performance.now());
      if (event.type === 'response.output_item.done' && event.item.type === 'compaction') {
        const t = compactionStarted.get(event.output_index);
        if (t !== undefined) compactionMs.push(performance.now() - t);
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') response = event.response;
      if (event.type === 'response.failed') throw new Error(`response failed: ${event.response.error?.code ?? 'unknown'}`);
    }
    if (!response) throw new Error('stream ended without a response');
    const usage = response.usage;
    steps.push({
      ttftMs: ttft,
      durationMs: performance.now() - stepStart,
      input: usage?.input_tokens ?? 0,
      cached: usage?.input_tokens_details.cached_tokens ?? 0,
      cacheWrite: usage?.input_tokens_details.cache_write_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      reasoning: usage?.output_tokens_details.reasoning_tokens ?? 0,
      status: response.status ?? 'unknown',
      outputTypes: response.output.map((item) => item.type),
      compactionMs,
      replayedItems: input.length,
      inputBytes: JSON.stringify(input).length,
    });
    const stored = response.output.flatMap((output) => fromOutput(output, family) ?? []);
    const calls = response.output.flatMap((output) => (output.type === 'function_call' ? [output] : []));
    lookups += calls.filter((c) => c.name === 'lookup_order').length;
    const outputs: StoredItem[] = calls.map((call) => ({ id: itemId(), type: 'call_output', callId: call.call_id, output: runTool(call.name, call.arguments, searches) }));
    const message = stored.findLast((item) => item.type === 'message');
    if (message?.type === 'message') answer = message.text;
    // One atomic append per step: its items and the outputs of its calls (ADR-0024).
    items.push(...stored, ...outputs);
    if (calls.length === 0) {
      // S5: a step that holds only a compaction item is retried, not ended.
      const onlyCompaction = response.output.length > 0 && response.output.every((o) => o.type === 'compaction' || o.type === 'reasoning');
      if (onlyCompaction && step < maxSteps) continue;
      break;
    }
  }
  return { steps, totalMs: performance.now() - started, answer, searches, lookups };
}

// Per 1M tokens, Standard, short context (https://developers.openai.com/api/docs/pricing; same as S5b/S7).
export const PRICES: Record<string, { input: number; cached: number; write: number; output: number }> = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 },
  'gpt-6.1-terra': { input: 1, cached: 0.05, write: 1.25, output: 5 },
};

export interface Usage { input: number; cached: number; cacheWrite: number; output: number }

export function usd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  return ((u.input - u.cached - u.cacheWrite) * p.input + u.cached * p.cached + u.cacheWrite * p.write + u.output * p.output) / 1e6;
}

/** Running total for the whole spike, so every script can stop before the budget. */
export class Spend {
  readonly byModel = new Map<string, Usage>();
  readonly budgetUsd: number;
  constructor(budgetUsd: number) {
    this.budgetUsd = budgetUsd;
  }
  add(model: string, u: Usage): void {
    const t = this.byModel.get(model) ?? { input: 0, cached: 0, cacheWrite: 0, output: 0 };
    this.byModel.set(model, { input: t.input + u.input, cached: t.cached + u.cached, cacheWrite: t.cacheWrite + u.cacheWrite, output: t.output + u.output });
  }
  addSteps(model: string, steps: readonly StepMetrics[]): void {
    for (const s of steps) this.add(model, s);
  }
  get usd(): number {
    return [...this.byModel].reduce((sum, [model, u]) => sum + usd(model, u), 0);
  }
  check(): void {
    if (this.usd > this.budgetUsd) throw new Error(`budget: ${this.usd.toFixed(4)} USD spent, limit ${this.budgetUsd}`);
  }
  toJSON(): unknown {
    return { usd: Number(this.usd.toFixed(4)), byModel: Object.fromEntries([...this.byModel].map(([m, u]) => [m, { ...u, usd: Number(usd(m, u).toFixed(4)) }])) };
  }
}
