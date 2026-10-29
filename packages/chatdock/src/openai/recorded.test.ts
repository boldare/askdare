import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import type { ModelGateway } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { createOpenAIGateway } from './gateway';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

/**
 * Streams recorded from the live Responses API in spike S1 (spikes/s1-openai), replayed byte for
 * byte. They catch drift between our mapper and what OpenAI really sends.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`./testing/fixtures/${name}.sse`, import.meta.url), 'utf8');

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

async function replay(name: string): Promise<{ events: ProtocolEvent[]; reason: string }> {
  server.use(
    http.post(
      `${OPENAI_TEST_BASE_URL}/responses`,
      () => new HttpResponse(fixture(name), { headers: { 'Content-Type': 'text/event-stream' } }),
    ),
  );
  const events: ProtocolEvent[] = [];
  const result = await gateway.runTurn({
    bot,
    conversationId: 'conv_recorded',
    text: 'replayed',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return { events, reason: result.reason };
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

  it('maps a file_search turn to text plus one file citation', async () => {
    const { events } = await replay('file-search');
    expect(textOf(events)).toContain('Pixel');
    expect(events.filter((event) => event.type === 'citation')).toEqual([
      {
        type: 'citation',
        messageId: 'msg_r',
        index: 1,
        title: 'chatdock-handbook.md',
        url: undefined,
      },
    ]);
  });

  it('keeps tool calls on the server', async () => {
    const { events } = await replay('function-call');
    expect(events.some((event) => JSON.stringify(event).includes('get_weather'))).toBe(false);
  });
});
