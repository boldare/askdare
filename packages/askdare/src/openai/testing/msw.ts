import { type HttpHandler, HttpResponse, http } from 'msw';

/** Base URL the tests point the SDK at; MSW intercepts it, so nothing reaches the network. */
export const OPENAI_TEST_BASE_URL: string = 'https://api.openai.test/v1';

/** A Responses API stream event as sent on the wire (without `sequence_number`, added here). */
export type FixtureEvent = Readonly<{ type: string } & Record<string, unknown>>;

export interface FixtureUsage {
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

export interface StreamOptions {
  /** Delay between events, in ms. */
  readonly delayMs?: number;
  /** Keep the connection open after the last event, as a stalled upstream would. */
  readonly hang?: boolean;
}

const encoder = new TextEncoder();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function sseStream(
  events: readonly FixtureEvent[],
  options: StreamOptions = {},
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [index, event] of events.entries()) {
        if (options.delayMs) await sleep(options.delayMs);
        if (signal?.aborted) return;
        const data = JSON.stringify({ ...event, sequence_number: index });
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${data}\n\n`));
      }
      if (!options.hang) {
        controller.close();
        return;
      }
      // A stalled upstream: keep the connection open until the client gives up.
      signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
  });
}

export function responseObject(
  status: 'completed' | 'incomplete',
  usage: FixtureUsage,
  incompleteReason?: string,
): Record<string, unknown> {
  return {
    id: 'resp_test',
    object: 'response',
    status,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    output: [],
    usage: {
      input_tokens: usage.input,
      input_tokens_details: { cached_tokens: usage.cached, cache_write_tokens: 0 },
      output_tokens: usage.output,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.input + usage.output,
    },
  };
}

export interface TextTurnOptions {
  readonly usage?: FixtureUsage;
  readonly status?: 'completed' | 'incomplete';
  readonly incompleteReason?: string;
  /** Events inserted after the text deltas, before the terminal event. */
  readonly extra?: readonly FixtureEvent[];
}

/** A typical text-only Responses stream: created, message item, deltas, terminal event. */
export function textTurnEvents(
  chunks: readonly string[],
  options: TextTurnOptions = {},
): FixtureEvent[] {
  const usage = options.usage ?? { input: 120, cached: 100, output: 30 };
  const status = options.status ?? 'completed';
  return [
    { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: 'msg_out',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: [],
      },
    },
    ...chunks.map(
      (delta): FixtureEvent => ({
        type: 'response.output_text.delta',
        item_id: 'msg_out',
        output_index: 0,
        content_index: 0,
        delta,
        logprobs: [],
      }),
    ),
    ...(options.extra ?? []),
    {
      type: status === 'completed' ? 'response.completed' : 'response.incomplete',
      response: responseObject(status, usage, options.incompleteReason),
    },
  ];
}

export interface CapturedRequest {
  body: Record<string, unknown> | undefined;
}

/** Answers `POST /responses` with the given stream and records the request body. */
export function responsesHandler(
  events: readonly FixtureEvent[],
  options: StreamOptions = {},
  capture?: CapturedRequest,
): HttpHandler {
  return http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
    if (capture) capture.body = (await request.json()) as Record<string, unknown>;
    return new HttpResponse(sseStream(events, options, request.signal), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}

export function conversationsCreateHandler(
  id = 'conv_test',
  capture?: CapturedRequest,
): HttpHandler {
  return http.post(`${OPENAI_TEST_BASE_URL}/conversations`, async ({ request }) => {
    if (capture) capture.body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ id, object: 'conversation', created_at: 0, metadata: {} });
  });
}
