import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testConversations } from './testing/conversations';
import {
  type CapturedRequest,
  conversationsCreateHandler,
  OPENAI_TEST_BASE_URL,
} from './testing/msw';

const server = setupServer();
const { store } = testConversations();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const conversation = (metadata: Record<string, string>) =>
  HttpResponse.json({ id: 'conv_x', object: 'conversation', created_at: 1_700_000_000, metadata });

describe('openaiConversations()', () => {
  it('creates a conversation tagged with its bot and owner', async () => {
    const capture: CapturedRequest = { body: undefined };
    server.use(conversationsCreateHandler('conv_new', capture));
    await expect(store.create({ botId: 'support', owner: 'visitor:v1' })).resolves.toBe('conv_new');
    expect(capture.body).toEqual({
      metadata: { askdare_bot: 'support', askdare_owner: 'visitor:v1' },
    });
  });

  it('reads the bot and owner back, also from conversations of 0.5 and earlier', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_x`, () =>
        conversation({ askdare_bot: 'support', askdare_owner: 'user:abc' }),
      ),
    );
    expect(await store.info('conv_x')).toEqual({
      id: 'conv_x',
      botId: 'support',
      owner: 'user:abc',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      version: 0,
    });
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_x`, () =>
        conversation({ askdare_bot: 'support', askdare_visitor: 'v_old' }),
      ),
    );
    expect(await store.info('conv_x')).toMatchObject({ botId: 'support', owner: 'visitor:v_old' });
  });

  it('answers an unknown conversation with undefined', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_gone`, () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    expect(await store.info('conv_gone')).toBeUndefined();
  });

  it('returns a provider reference as the turn context, without a request', async () => {
    expect(await store.context('conv_x')).toEqual({
      kind: 'provider',
      provider: 'openai',
      ref: 'conv_x',
      version: 0,
    });
  });

  it('appends tool outputs and visitor messages as Responses input items', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/conversations/conv_x/items`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ object: 'list', data: [], has_more: false });
      }),
    );
    await store.append('conv_x', [
      { id: 'i1', type: 'call_output', callId: 'call_1', output: '"shown"' },
      {
        id: 'i2',
        type: 'message',
        role: 'user',
        parts: [
          { type: 'page_context', text: 'Pricing page' },
          { type: 'text', text: 'And this?' },
          { type: 'file', fileId: 'file-img', kind: 'image' },
          { type: 'file', fileId: 'file-pdf', kind: 'pdf' },
        ],
      },
    ]);
    expect(bodies).toEqual([
      {
        items: [
          { type: 'function_call_output', call_id: 'call_1', output: '"shown"' },
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: expect.stringMatching(/^\[askdare:page-context\]\n[\s\S]*\nPricing page$/),
              },
              { type: 'input_text', text: 'And this?' },
              { type: 'input_image', file_id: 'file-img', detail: 'auto' },
              { type: 'input_file', file_id: 'file-pdf' },
            ],
          },
        ],
      },
    ]);
  });

  it('pages items oldest first, with citations from the stored search results', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_x/items`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('order')).toBe('desc');
        expect(url.searchParams.getAll('include[]')).toEqual(['file_search_call.results']);
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              id: 'msg_a',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: 'Plans start at 10 EUR.',
                  annotations: [{ type: 'file_citation', file_id: 'file-kb', index: 3 }],
                  logprobs: [],
                },
              ],
            },
            {
              id: 'fs_1',
              type: 'file_search_call',
              status: 'completed',
              queries: ['price'],
              results: [
                {
                  file_id: 'file-kb',
                  filename: 'pricing.md',
                  attributes: { title: 'Pricing', url: 'https://example.com/pricing' },
                },
              ],
            },
            {
              id: 'msg_u',
              type: 'message',
              role: 'user',
              status: 'completed',
              content: [{ type: 'input_text', text: 'How much?' }],
            },
          ],
          first_id: 'msg_a',
          last_id: 'msg_u',
          has_more: true,
        });
      }),
    );
    const page = await store.page('conv_x', { limit: 3 });
    expect(page.before).toBe('msg_u');
    expect(page.items.map(({ seq: _seq, at: _at, ...item }) => item)).toEqual([
      { id: 'msg_u', type: 'message', role: 'user', parts: [{ type: 'text', text: 'How much?' }] },
      expect.objectContaining({ id: 'fs_1', type: 'native', provider: 'openai' }),
      {
        id: 'msg_a',
        type: 'message',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: 'Plans start at 10 EUR.',
            citations: [{ title: 'Pricing', url: 'https://example.com/pricing' }],
          },
        ],
      },
    ]);
  });

  it('treats an already deleted conversation as deleted', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_gone/items`, () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
      http.delete(`${OPENAI_TEST_BASE_URL}/conversations/conv_gone`, () =>
        HttpResponse.json({ error: { message: 'not found' } }, { status: 404 }),
      ),
    );
    await expect(store.delete('conv_gone')).resolves.toEqual({ fileIds: [] });
  });

  it('returns the files the visitor attached, collected before deleting', async () => {
    const calls: string[] = [];
    const userMessage = (id: string, content: unknown[]) => ({
      id,
      type: 'message',
      role: 'user',
      status: 'completed',
      content,
    });
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_f/items`, () => {
        calls.push('list');
        return HttpResponse.json({
          object: 'list',
          data: [
            userMessage('msg_2', [
              { type: 'input_text', text: 'And this?' },
              { type: 'input_file', file_id: 'file-pdf' },
            ]),
            userMessage('msg_1', [
              { type: 'input_image', file_id: 'file-img', detail: 'auto' },
              { type: 'input_image', file_id: 'file-img', detail: 'auto' },
            ]),
          ],
          first_id: 'msg_2',
          last_id: 'msg_1',
          has_more: false,
        });
      }),
      http.delete(`${OPENAI_TEST_BASE_URL}/conversations/conv_f`, () => {
        calls.push('delete');
        return HttpResponse.json({ id: 'conv_f', deleted: true, object: 'conversation.deleted' });
      }),
    );
    const { fileIds } = await store.delete('conv_f');
    expect(calls).toEqual(['list', 'delete']);
    expect([...fileIds].sort()).toEqual(['file-img', 'file-pdf']);
  });

  it('still deletes the conversation when listing its files fails, leaving them to expire', async () => {
    let deleted = false;
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_x/items`, () =>
        HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
      ),
      http.delete(`${OPENAI_TEST_BASE_URL}/conversations/conv_x`, () => {
        deleted = true;
        return HttpResponse.json({ id: 'conv_x', deleted: true, object: 'conversation.deleted' });
      }),
    );
    await expect(store.delete('conv_x')).resolves.toEqual({ fileIds: [] });
    expect(deleted).toBe(true);
  });
});
