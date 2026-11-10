import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import type { ModelGateway, StepRecord } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';
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

const bot = defineBot({ id: 'support', model: 'gpt-6.1-terra', instructions: 'Be brief.' });

function request(events: ProtocolEvent[]) {
  return {
    bot,
    conversationId: 'conv_recorded',
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
): Promise<{ events: ProtocolEvent[]; reason: string; steps: StepRecord[] }> {
  server.use(
    http.post(
      `${OPENAI_TEST_BASE_URL}/responses`,
      () => new HttpResponse(fixture(name), { headers: { 'Content-Type': 'text/event-stream' } }),
    ),
  );
  const events: ProtocolEvent[] = [];
  const steps: StepRecord[] = [];
  const result = await gateway.runTurn({
    bot,
    conversationId: 'conv_recorded',
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
    const messages = await gateway.listMessages('conv_recorded');
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

  it('runs a recorded tool call and keeps its arguments on the server', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        const stream = bodies.length === 1 ? fixture('function-call') : textStream('It is 12°C.');
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );
    const weatherBot = defineBot({
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
});
