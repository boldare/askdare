import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ModelGateway } from '../gateway';
import { createOpenAIGateway } from './gateway';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

const server = setupServer();
let gateway: ModelGateway;
let query: URLSearchParams | undefined;
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

// Newest first, as the API returns them by default (verified in spike S1).
const ITEMS = [
  {
    id: 'msg_4',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [
      {
        type: 'output_text',
        text: 'Pixel, see the handbook.',
        annotations: [
          { type: 'file_citation', file_id: 'file_1', filename: 'handbook.md', index: 5 },
          {
            type: 'url_citation',
            url: 'javascript:alert(1)',
            title: 'bad',
            start_index: 0,
            end_index: 1,
          },
          {
            type: 'url_citation',
            url: 'https://example.com/a',
            title: 'A',
            start_index: 0,
            end_index: 1,
          },
        ],
        logprobs: [],
      },
    ],
  },
  { id: 'fs_1', type: 'file_search_call', status: 'completed', queries: ['dog'], results: null },
  { id: 'rs_1', type: 'reasoning', summary: [] },
  {
    id: 'msg_3',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    phase: 'commentary',
    content: [{ type: 'output_text', text: 'Let me check…', annotations: [], logprobs: [] }],
  },
  {
    id: 'msg_2',
    type: 'message',
    role: 'user',
    status: 'completed',
    content: [
      { type: 'input_text', text: '[chatdock:page-context]\nThe website describes the page…' },
      { type: 'input_text', text: 'What is the dog called?' },
      { type: 'input_image', file_id: 'file_img', detail: 'low' },
    ],
  },
  {
    id: 'fc_1',
    type: 'function_call',
    call_id: 'c1',
    name: 'get_weather',
    arguments: '{}',
    status: 'completed',
  },
  { id: 'future_1', type: 'something_new', payload: 1 },
  {
    id: 'msg_1',
    type: 'message',
    role: 'developer',
    status: 'completed',
    content: [{ type: 'input_text', text: 'secret' }],
  },
];

describe('listMessages', () => {
  it('returns only visible user and assistant messages, oldest first', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_1/items`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({
          object: 'list',
          data: ITEMS,
          first_id: 'msg_4',
          last_id: 'msg_1',
          has_more: false,
        });
      }),
    );
    const messages = await gateway.listMessages('conv_1');
    expect(query?.get('order')).toBe('desc');
    expect(query?.getAll('include[]')).toEqual(['file_search_call.results']);
    expect(messages).toEqual([
      { id: 'msg_2', role: 'user', text: 'What is the dog called?', citations: [], attachments: 1 },
      {
        id: 'msg_4',
        role: 'assistant',
        text: 'Pixel, see the handbook.',
        citations: [
          { index: 1, title: 'handbook.md', url: undefined },
          { index: 2, title: 'A', url: 'https://example.com/a' },
        ],
        attachments: 0,
      },
    ]);
  });

  it('links file citations to the title and URL stored with the searched file', async () => {
    const result = (fileId: string, title: string, url: string) => ({
      file_id: fileId,
      filename: `${fileId}.md`,
      score: 0.9,
      text: 'chunk',
      attributes: { path: `${fileId}.md`, sha256: 'x', title, url },
    });
    const citation = (fileId: string) => ({
      type: 'file_citation',
      file_id: fileId,
      filename: `${fileId}.md`,
      index: 1,
    });
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_kb/items`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              id: 'msg_2',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: 'Plans start at 10 EUR.',
                  annotations: [citation('file_a'), citation('file_b'), citation('file_c')],
                  logprobs: [],
                },
              ],
            },
            {
              id: 'fs_1',
              type: 'file_search_call',
              status: 'completed',
              queries: ['pricing'],
              results: [
                result('file_a', 'Pricing', 'https://example.com/pricing'),
                result('file_b', 'Pricing FAQ', 'https://example.com/pricing'),
                result('file_c', 'Notes', 'javascript:alert(1)'),
              ],
            },
            {
              id: 'fs_0',
              type: 'file_search_call',
              status: 'completed',
              queries: ['older search, before a retag'],
              results: [result('file_a', 'Old pricing', 'https://example.com/old-pricing')],
            },
          ],
          first_id: 'msg_2',
          last_id: 'fs_0',
          has_more: false,
        }),
      ),
    );
    const [message] = await gateway.listMessages('conv_kb');
    expect(message?.citations).toEqual([
      { index: 1, title: 'Pricing', url: 'https://example.com/pricing' },
      { index: 2, title: 'Notes', url: undefined },
    ]);
  });

  it('reports a deleted conversation as not_found', async () => {
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_gone/items`, () =>
        HttpResponse.json(
          {
            error: {
              message: "Conversation with id 'conv_gone' not found.",
              type: 'invalid_request_error',
              param: null,
              code: null,
            },
          },
          { status: 404 },
        ),
      ),
    );
    await expect(gateway.listMessages('conv_gone')).rejects.toMatchObject({ code: 'not_found' });
  });
});
