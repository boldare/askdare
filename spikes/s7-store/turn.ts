/**
 * One chat turn the way `packages/askdare/src/openai/turn.ts` runs it, in two modes:
 * - `conversation`: today's default, `conversation` + `store: true`, the provider records items.
 * - `stateless`: `store: false`, the history replayed from an item store, every item appended.
 *
 * Write order in stateless mode (question 1):
 *   1. read the context (items + version);
 *   2. append the visitor's message (expect: version) before the first model call;
 *   3. after each step, append its output items together with the outputs of its calls, in one
 *      atomic append (expect: version). A call is never stored without its output, so a crash
 *      can't leave a dangling call; it loses at most the step in flight.
 */
import OpenAI from 'openai';
import type { ResponseInputItem, ResponseUsage } from 'openai/resources/responses/responses';
import { fromOutput, itemId, modelFamily, replay, toInput } from './openai-map.ts';
import type { ConversationStore, StoredItem, StoredPart } from './port.ts';

/** Static instructions above the 1,024-token cache minimum, like a real site's bot. */
export const INSTRUCTIONS = (() => {
  const topics = ['delivery times', 'returns', 'warranty', 'payment methods', 'gift cards', 'assembly service', 'damaged items', 'order changes', 'invoices', 'store hours', 'loyalty points', 'price matching', 'custom furniture', 'bulk orders', 'international shipping', 'product care', 'out-of-stock items', 'pre-orders', 'cancellations', 'refund timing', 'click and collect', 'installation', 'recycling old furniture', 'student discount', 'accessibility support'];
  const lines = topics.map((topic, index) => `${index + 1}. ${topic[0]!.toUpperCase()}${topic.slice(1)}: answer from the policy summary for ${topic}; mention that details are on the help page for ${topic}, and offer to look up the visitor's order with lookup_order when the question concerns a specific order. Never promise exceptions to the ${topic} policy; a human agent decides those within two working days.`);
  return [
    'You are the support assistant of Northwind Home, an online shop for furniture and home goods.',
    'Answer briefly (at most three sentences), politely and in the language the visitor writes in.',
    'If you do not know something, say so and suggest contacting support@northwind.example.',
    'Use lookup_order whenever the visitor mentions an order number. Do not invent order data.',
    'Policies by topic:',
    ...lines,
  ].join('\n');
})();

const TOOLS = [
  {
    type: 'function' as const,
    name: 'lookup_order',
    description: 'Looks up an order by its number and returns its status, items and delivery estimate.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string', description: 'The order number, digits only.' } },
      required: ['order_id'],
      additionalProperties: false,
    },
  },
];

function lookupOrder(args: string): string {
  let orderId = '';
  try {
    orderId = String((JSON.parse(args) as { order_id?: unknown }).order_id ?? '');
  } catch {
    // Strict tools always send JSON; keep the fake tool robust anyway.
  }
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
  });
}

export interface StepMetrics {
  readonly ttftMs: number | undefined;
  readonly durationMs: number;
  readonly input: number;
  readonly cached: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly outputTypes: readonly string[];
  readonly transformations: readonly string[];
  readonly reasoningContext: string | undefined;
  /** Bytes of the request's `input` array. */
  readonly inputBytes: number;
}

export interface TurnMetrics {
  readonly mode: 'conversation' | 'stateless';
  readonly steps: readonly StepMetrics[];
  readonly totalMs: number;
  /** Store reads and writes on the hot path. */
  readonly contextMs: number;
  readonly appendMs: number;
  readonly replayedItems: number;
  readonly answer: string;
  readonly answerItemId: string | undefined;
}

export interface TurnOptions {
  readonly client: OpenAI;
  readonly model: string;
  readonly store: ConversationStore;
  readonly conversationId: string;
  readonly text: string;
  readonly fileIds?: readonly string[];
  readonly safetyIdentifier: string;
  readonly maxSteps?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: { readonly effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' };
  /** Stateless only: throw after this step's model call, before its append (a crashed server). */
  readonly crashAfterStep?: number;
  /** Stateless only: replay reasoning items without their `id`. */
  readonly keepReasoningIds?: boolean;
}

export async function runTurn(options: TurnOptions): Promise<TurnMetrics> {
  const { client, model, store, conversationId } = options;
  const family = modelFamily(model);
  const started = performance.now();
  let contextMs = 0;
  let appendMs = 0;
  const timed = async <T>(work: () => Promise<T>, add: (ms: number) => void): Promise<T> => {
    const t = performance.now();
    try {
      return await work();
    } finally {
      add(performance.now() - t);
    }
  };

  const context = await timed(() => store.context(conversationId), (ms) => (contextMs += ms));
  const mode = context.kind === 'provider' ? 'conversation' : 'stateless';
  const parts: StoredPart[] = [{ type: 'text', text: options.text }, ...(options.fileIds ?? []).map((fileId) => ({ type: 'file' as const, fileId, kind: 'image' as const }))];
  const userItem: StoredItem = { id: itemId(), type: 'message', role: 'user', parts };
  let version = context.version;
  let history: ResponseInputItem[] = [];
  if (context.kind === 'items') {
    version = await timed(() => store.append(conversationId, [userItem], { expect: version }), (ms) => (appendMs += ms));
    history = replay([...context.items, userItem], family, options.keepReasoningIds === false ? { keepReasoningIds: false } : {});
  }
  let pending: ResponseInputItem[] = context.kind === 'provider' ? [toInput(userItem, family)!] : [];

  const steps: StepMetrics[] = [];
  const maxSteps = options.maxSteps ?? 3;
  let answer = '';
  let answerItemId: string | undefined;
  for (let step = 1; step <= maxSteps; step += 1) {
    const input = context.kind === 'provider' ? pending : history;
    const stepStart = performance.now();
    let ttft: number | undefined;
    const stream = await client.responses.create({
      model,
      instructions: INSTRUCTIONS,
      input,
      ...(context.kind === 'provider' ? { conversation: context.ref, store: true } : { store: false }),
      stream: true,
      max_output_tokens: options.maxOutputTokens ?? 1_024,
      truncation: 'auto',
      safety_identifier: options.safetyIdentifier,
      prompt_cache_key: 'askdare:spike-s7',
      tools: TOOLS,
      tool_choice: step === maxSteps ? 'none' : 'auto',
      parallel_tool_calls: true,
      ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    });
    let response: OpenAI.Responses.Response | undefined;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta' && ttft === undefined) ttft = performance.now() - stepStart;
      if (event.type === 'response.completed' || event.type === 'response.incomplete') response = event.response;
      if (event.type === 'response.failed') throw new Error(`response failed: ${event.response.error?.code ?? 'unknown'}`);
    }
    if (!response) throw new Error('stream ended without a response');
    const usage: ResponseUsage | undefined = response.usage ?? undefined;
    steps.push({
      ttftMs: ttft,
      durationMs: performance.now() - stepStart,
      input: usage?.input_tokens ?? 0,
      cached: usage?.input_tokens_details.cached_tokens ?? 0,
      cacheWrite: usage?.input_tokens_details.cache_write_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      reasoning: usage?.output_tokens_details.reasoning_tokens ?? 0,
      outputTypes: response.output.map((item) => item.type),
      transformations: (response.input_transformations ?? []).map((t) => t.reason),
      reasoningContext: (response.reasoning as { context?: string } | null)?.context,
      inputBytes: JSON.stringify(input).length,
    });

    const stored = response.output.flatMap((output) => fromOutput(output, family) ?? []);
    const calls = response.output.flatMap((output) => (output.type === 'function_call' ? [output] : []));
    const outputs: StoredItem[] = calls.map((call) => ({ id: itemId(), type: 'call_output', callId: call.call_id, output: lookupOrder(call.arguments) }));
    const message = stored.findLast((item) => item.type === 'message');
    if (message?.type === 'message') {
      answer = message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
      answerItemId = context.kind === 'items' ? message.id : response.output.findLast((o) => o.type === 'message')?.id;
    }
    if (context.kind === 'items') {
      if (options.crashAfterStep === step) throw new Error('simulated crash before the append');
      // One atomic append: the step's items and the outputs of its calls.
      version = await timed(() => store.append(conversationId, [...stored, ...outputs], { expect: version }), (ms) => (appendMs += ms));
      history = [...history, ...replay([...stored, ...outputs], family)];
    } else {
      pending = outputs.flatMap((item) => toInput(item, family) ?? []);
    }
    if (calls.length === 0) break;
  }
  return {
    mode,
    steps,
    totalMs: performance.now() - started,
    contextMs,
    appendMs,
    replayedItems: context.kind === 'items' ? context.items.length + 1 : 0,
    answer,
    answerItemId,
  };
}
