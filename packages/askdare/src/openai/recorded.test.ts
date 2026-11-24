import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBot } from '../bot/define-bot';
import type { ModelGateway, StepRecord } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';
import { testConversations } from './testing/conversations';
import { OPENAI_TEST_BASE_URL, textTurnEvents } from './testing/msw';

/**
 * Streams recorded from the live Responses API in spikes S1 (spikes/s1-openai) and S5
 * (spikes/s5-compaction), replayed byte for byte. They catch drift between our mapper and what
 * OpenAI really sends.
 */
const fixture = (name: string, extension = 'sse'): string =>
  readFileSync(new URL(`./testing/fixtures/${name}.${extension}`, import.meta.url), 'utf8');

const server = setupServer();
let gateway: ModelGateway;
const conversations = testConversations();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  gateway = createOpenAIGateway({
    apiKey: 'sk-test',
    baseURL: OPENAI_TEST_BASE_URL,
    maxRetries: 0,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const bot = createBot({ id: 'support', model: 'gpt-6.1-terra', instructions: 'Be brief.' });

function request(events: ProtocolEvent[]) {
  return {
    bot,
    conversationId: 'conv_recorded',
    conversations: conversations.store,
    text: 'replayed',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    visitorId: `v_${'0f'.repeat(16)}`,
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: (event: ProtocolEvent) => events.push(event),
  };
}

const textStream = (text: string): string =>
  textTurnEvents([text])
    .map(
      (event, index) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`,
    )
    .join('');

async function replay(
  name: string,
  edit: (sse: string) => string = (sse) => sse,
): Promise<{ events: ProtocolEvent[]; reason: string; steps: StepRecord[] }> {
  const body = edit(fixture(name));
  server.use(
    http.post(
      `${OPENAI_TEST_BASE_URL}/responses`,
      () => new HttpResponse(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    ),
  );
  const events: ProtocolEvent[] = [];
  const steps: StepRecord[] = [];
  const result = await gateway.runTurn({
    bot,
    conversationId: 'conv_recorded',
    conversations: conversations.store,
    text: 'replayed',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    visitorId: `v_${'0f'.repeat(16)}`,
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    onStep: (step) => steps.push(step),
  });
  return { events, reason: result.reason, steps };
}

const textOf = (events: readonly ProtocolEvent[]): string =>
  events.flatMap((event) => (event.type === 'text.delta' ? [event.delta] : [])).join('');

/** The recording's events, each as `event:` and `data:` lines. */
const sseBlocks = (sse: string): string[] => sse.split('\n\n').filter((block) => block !== '');
const sseData = (block: string): Record<string, unknown> =>
  JSON.parse(block.slice(block.indexOf('data: ') + 'data: '.length)) as Record<string, unknown>;
const sseBlock = (data: Record<string, unknown>): string =>
  `event: ${String(data['type'])}\ndata: ${JSON.stringify(data)}`;

/** Adds text deltas to a recording right after its first annotation, as a model may write them. */
const withDeltasAfterAnnotation =
  (deltas: readonly string[]) =>
  (sse: string): string => {
    const blocks = sseBlocks(sse);
    const template = blocks.find((block) => block.startsWith('event: response.output_text.delta'));
    const at = blocks.findIndex((block) =>
      block.startsWith('event: response.output_text.annotation.added'),
    );
    if (!template || at === -1) throw new Error('The recording has no text or no annotation.');
    const added = deltas.map((delta) => sseBlock({ ...sseData(template), delta }));
    return `${[...blocks.slice(0, at + 1), ...added, ...blocks.slice(at + 1)].join('\n\n')}\n\n`;
  };

/** Removes the optional usage details from the terminal event, as some Open Responses servers do. */
const withoutUsageDetails = (sse: string): string =>
  `${sseBlocks(sse)
    .map((block) => {
      if (!block.startsWith('event: response.completed')) return block;
      const data = sseData(block) as { response: { usage: Record<string, unknown> } };
      delete data.response.usage['input_tokens_details'];
      delete data.response.usage['output_tokens_details'];
      return sseBlock(data);
    })
    .join('\n\n')}\n\n`;

describe('recorded Responses API streams', () => {
  it('maps a plain text turn', async () => {
    const { events, reason } = await replay('text-turn');
    expect(textOf(events)).toBe('The sea shimmered beneath the morning sun.');
    expect(reason).toBe('completed');
    expect(events.every((event) => event.type === 'text.delta')).toBe(true);
  });

  it('maps a turn that compacts the conversation to its answer alone', async () => {
    // Compaction items arrive before and after the message; they stay on the server.
    const { events, reason, steps } = await replay('compaction-turn');
    expect(textOf(events)).toBe('noted');
    expect(reason).toBe('completed');
    expect(events.every((event) => event.type === 'text.delta')).toBe(true);
    // The compaction passes are reported as reasoning tokens.
    expect(steps).toEqual([
      {
        model: 'gpt-6.1-terra',
        usage: {
          inputTokens: 1714,
          cachedInputTokens: 1065,
          cacheWriteTokens: 525,
          outputTokens: 219,
          reasoningTokens: 213,
        },
      },
    ]);
  });

  it('ends a response that only compacted as max_output_tokens, with zero usage', async () => {
    // Spike S5: compaction counts against max_output_tokens and can leave no answer.
    const { events, reason, steps } = await replay('compaction-only');
    expect(events).toEqual([]);
    expect(reason).toBe('max_output_tokens');
    expect(steps.map((step) => step.usage.inputTokens + step.usage.outputTokens)).toEqual([0]);
  });

  it('lists a compacted conversation without its compaction items', async () => {
    server.use(
      http.get(
        `${OPENAI_TEST_BASE_URL}/conversations/conv_recorded/items`,
        () =>
          new HttpResponse(fixture('compaction-items', 'json'), {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const messages = await conversations.listMessages('conv_recorded');
    // Compaction keeps every earlier message in the conversation, so history still shows them.
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(messages[0]?.text).toContain('PAPAYA-42');
    expect(messages.at(-1)?.text).toBe('noted');
  });

  it('maps a file_search turn to text plus one file citation', async () => {
    const { events, steps } = await replay('file-search');
    // Every counter OpenAI reports, for onUsage.
    expect(steps).toEqual([
      {
        model: 'gpt-6.1-terra',
        usage: {
          inputTokens: 2049,
          cachedInputTokens: 0,
          cacheWriteTokens: 1480,
          outputTokens: 58,
          reasoningTokens: 30,
        },
      },
    ]);
    expect(textOf(events)).toContain('Pixel');
    expect(events.filter((event) => event.type === 'citation')).toEqual([
      {
        type: 'citation',
        messageId: 'msg_r',
        index: 1,
        title: 'askdare-handbook.md',
        url: undefined,
      },
    ]);
  });

  it('merges a repeated citation marker, also when the repeat arrives in a later delta', async () => {
    // Spike S8: one answer cited the same passage twice in a row, which showed as `[1] [1]`.
    const { events } = await replay(
      'file-search',
      withDeltasAfterAnnotation(['[1] [', '1] Pixel visits', ' on Fridays [1]', '[1', '].']),
    );
    expect(textOf(events)).toBe(
      'The office dog is called **Pixel**. [1] Pixel visits on Fridays [1].',
    );
    expect(events.filter((event) => event.type === 'citation')).toHaveLength(1);
  });

  it('counts usage details a server left out as zero', async () => {
    // Spike S6b: the details objects are optional on Open Responses servers.
    const { events, reason, steps } = await replay('text-turn', withoutUsageDetails);
    expect(textOf(events)).toBe('The sea shimmered beneath the morning sun.');
    expect(reason).toBe('completed');
    expect(steps).toEqual([
      {
        model: expect.any(String),
        usage: {
          inputTokens: 21,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 13,
          reasoningTokens: 0,
        },
      },
    ]);
  });

  it('runs a recorded tool call and keeps its arguments on the server', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        const stream = bodies.length === 1 ? fixture('function-call') : textStream('It is 12°C.');
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const weatherBot = createBot({
      id: 'support',
      model: 'gpt-6.1-terra',
      instructions: 'Use tools.',
      tools: [
        defineTool({
          name: 'get_weather',
          description: 'Current weather for a city.',
          input: z.object({ city: z.string() }),
          execute: ({ city }) => ({ city, tempC: 12 }),
        }),
      ],
    });
    const events: ProtocolEvent[] = [];
    await gateway.runTurn({ ...request(events), bot: weatherBot });

    const call = /"call_id":"(call_[A-Za-z0-9]+)"/.exec(fixture('function-call'))?.[1];
    expect(bodies[1]?.['input']).toEqual([
      {
        type: 'function_call_output',
        call_id: call,
        output: JSON.stringify({ city: 'Warsaw', tempC: 12 }),
      },
    ]);
    expect(
      events.filter((event) => event.type === 'tool.status').map((event) => event.state),
    ).toEqual(['running', 'done']);
    expect(JSON.stringify(events)).not.toContain('Warsaw');
    expect(textOf(events)).toBe('It is 12°C.');
  });

  it("sends the recorded call's UI payload after its status, and only what ui picked (ADR-0017)", async () => {
    let served = false;
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/responses`, () => {
        const first = !served;
        served = true;
        const stream = first ? fixture('function-call') : textStream('It is 12°C.');
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const weatherBot = createBot({
      id: 'support',
      model: 'gpt-6.1-terra',
      instructions: 'Use tools.',
      tools: [
        defineTool({
          name: 'get_weather',
          description: 'Current weather for a city.',
          input: z.object({ city: z.string() }),
          execute: ({ city }) => ({ city, tempC: 12, station: 'internal-42' }),
          ui: (result) => ({ tempC: result.tempC }),
        }),
      ],
    });
    const events: ProtocolEvent[] = [];
    await gateway.runTurn({ ...request(events), bot: weatherBot });

    const call = /"call_id":"(call_[A-Za-z0-9]+)"/.exec(fixture('function-call'))?.[1];
    const kinds = events
      .filter((event) => event.type === 'tool.status' || event.type === 'tool.ui')
      .map((event) => (event.type === 'tool.status' ? event.state : event.type));
    expect(kinds).toEqual(['running', 'done', 'tool.ui']);
    expect(events.find((event) => event.type === 'tool.ui')).toEqual({
      type: 'tool.ui',
      messageId: 'msg_r',
      callId: call,
      name: 'get_weather',
      data: { tempC: 12 },
    });
    const ui = events.findIndex((event) => event.type === 'tool.ui');
    expect(events.findIndex((event) => event.type === 'text.delta')).toBeGreaterThan(ui);
    expect(JSON.stringify(events)).not.toContain('internal-42');
  });
});
