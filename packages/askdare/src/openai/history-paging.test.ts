import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoredItem } from '../conversations/port';
import { historyReader } from '../conversations/provider-history';
import {
  expectWholeTurnPages,
  longConversation,
  readEveryPage,
} from '../conversations/testing/long-conversation';
import { testConversations } from './testing/conversations';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

const server = setupServer();
const conversations = testConversations();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A stored item as the Conversations API lists it. */
function conversationItem(item: StoredItem): Record<string, unknown> {
  switch (item.type) {
    case 'message': {
      const text = item.parts.map((part) => ('text' in part ? part.text : '')).join('');
      return {
        id: item.id,
        type: 'message',
        role: item.role,
        status: 'completed',
        ...(item.phase ? { phase: item.phase } : {}),
        content: [
          item.role === 'assistant'
            ? { type: 'output_text', text, annotations: [], logprobs: [] }
            : { type: 'input_text', text },
        ],
      };
    }
    case 'call':
      return {
        id: item.id,
        type: 'function_call',
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
        status: 'completed',
      };
    case 'call_output':
      return {
        id: item.id,
        type: 'function_call_output',
        call_id: item.callId,
        output: item.output,
        status: 'completed',
      };
    default:
      throw new Error(`no ${item.type} items here`);
  }
}

/** Lists `items` as the API does: newest first, at most `limit`, after the item ID `after`. */
function serve(id: string, items: readonly StoredItem[], limits: number[]): void {
  const newestFirst = items.toReversed().map(conversationItem);
  server.use(
    http.get(`${OPENAI_TEST_BASE_URL}/conversations/${id}/items`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get('order')).toBe('desc');
      const limit = Number(query.get('limit'));
      limits.push(limit);
      const after = query.get('after');
      const start = after ? newestFirst.findIndex((item) => item['id'] === after) + 1 : 0;
      const data = newestFirst.slice(start, start + limit);
      return HttpResponse.json({
        object: 'list',
        data,
        first_id: data[0]?.['id'] ?? null,
        last_id: data.at(-1)?.['id'] ?? null,
        has_more: start + limit < newestFirst.length,
      });
    }),
  );
}

describe('openaiConversations history: pages of whole turns (ADR-0024, decision 7)', () => {
  const read = historyReader(conversations.store);
  if (!read) throw new Error('no history reader');

  it('pages through a whole conversation with items.list cursors', async () => {
    const stored = longConversation(41);
    const limits: number[] = [];
    serve('conv_long', stored, limits);
    await expectWholeTurnPages(read, 'conv_long', stored);
    // The API returns at most 100 items per page.
    expect(Math.max(...limits)).toBeLessThanOrEqual(100);
  });

  it('answers a short conversation with one page and no cursor, as before', async () => {
    const stored = longConversation(3);
    serve('conv_short', stored, []);
    const pages = await readEveryPage(read, 'conv_short', {});
    expect(pages).toHaveLength(1);
    expect(pages[0]?.next).toBeUndefined();
    expect(pages[0]?.messages.map((message) => message.id)).toEqual([
      'itm_u1',
      'itm_a1',
      'itm_u2',
      'itm_a2',
      'itm_u3',
      'itm_a3',
    ]);
  });
});
