import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModelGateway } from '../gateway';
import { defineTool, readToolReplies } from '../tools/define-tool';
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
      { type: 'input_text', text: '[askdare:page-context]\nThe website describes the page…' },
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

  describe('reply options of the latest answer (ADR-0015)', () => {
    const message = (id: string, role: 'user' | 'assistant', text: string) => ({
      id,
      type: 'message',
      role,
      status: 'completed',
      content: [
        role === 'user'
          ? { type: 'input_text', text }
          : { type: 'output_text', text, annotations: [], logprobs: [] },
      ],
    });
    const call = (id: string, name: string, args: string) => ({
      id,
      type: 'function_call',
      call_id: `call_${id}`,
      name,
      arguments: args,
      status: 'completed',
    });
    const output = (id: string, text: string) => ({
      id: `out_${id}`,
      type: 'function_call_output',
      call_id: `call_${id}`,
      output: text,
      status: 'completed',
    });
    const serve = (conversation: string, data: readonly unknown[]) =>
      server.use(
        http.get(`${OPENAI_TEST_BASE_URL}/conversations/${conversation}/items`, () =>
          HttpResponse.json({
            object: 'list',
            data,
            first_id: null,
            last_id: null,
            has_more: false,
          }),
        ),
      );
    // Newest first: the latest turn called a tool and suggested replies; an older one did too.
    const TURNS = [
      call('fc_4', 'suggest', '{"items":["Later"]}'),
      message('msg_4', 'assistant', 'Two slots are free.'),
      output('fc_3', '{"slots":["9:00","11:00"]}'),
      call('fc_3', 'find_slots', '{}'),
      message('msg_3', 'user', 'Book a call'),
      call('fc_2', 'suggest', '{"items":["Old"]}'),
      message('msg_2', 'assistant', 'Hi!'),
      message('msg_1', 'user', 'Hello'),
    ];

    it("hands the reader only the latest turn's calls, oldest first, with their outputs", async () => {
      serve('conv_r', TURNS);
      const reader = vi.fn(() => [' Book 9:00 ', 'Book 9:00', 'Book 11:00', 'See www.example.com']);
      const messages = await gateway.listMessages('conv_r', undefined, reader);
      expect(reader).toHaveBeenCalledOnce();
      expect(reader).toHaveBeenCalledWith([
        { name: 'find_slots', arguments: '{}', output: '{"slots":["9:00","11:00"]}' },
        { name: 'suggest', arguments: '{"items":["Later"]}', output: undefined },
      ]);
      expect(messages.map((item) => item.replies)).toEqual([
        undefined,
        undefined,
        undefined,
        ['Book 9:00', 'Book 11:00'],
      ]);
    });

    it('offers nothing once the visitor has replied, without a reader, or when it fails', async () => {
      serve('conv_replied', [message('msg_5', 'user', 'Thanks'), ...TURNS]);
      const reader = vi.fn(() => ['Yes']);
      const replied = await gateway.listMessages('conv_replied', undefined, reader);
      expect(reader).not.toHaveBeenCalled();
      expect(replied.some((item) => item.replies)).toBe(false);

      serve('conv_r', TURNS);
      expect((await gateway.listMessages('conv_r')).some((item) => item.replies)).toBe(false);
      const failing = await gateway.listMessages('conv_r', undefined, () => {
        throw new Error('bad arguments');
      });
      expect(failing.at(-1)?.text).toBe('Two slots are free.');
      expect(failing.some((item) => item.replies)).toBe(false);
      const empty = await gateway.listMessages('conv_r', undefined, () => ['https://x.example']);
      expect(empty.some((item) => item.replies)).toBe(false);
    });

    describe('defined by tools', () => {
      const slots = defineTool({
        name: 'find_slots',
        description: 'd',
        input: z.object({}),
        execute: () => ({ slots: ['9:00'] }),
        replies: (result) => result.slots.map((slot) => `Book ${slot}`),
      });
      const fallback = defineTool({
        name: 'fallback',
        description: 'd',
        input: z.object({}),
        execute: () => null,
        replies: () => ['Talk to a person'],
      });
      const reader = (calls: Parameters<typeof readToolReplies>[1]) =>
        readToolReplies([slots, fallback], calls);
      const turn = (...calls: readonly unknown[]) => [
        message('msg_9', 'assistant', 'Here you go.'),
        ...calls,
        message('msg_8', 'user', 'Book a call'),
      ];
      const latestReplies = async (conversation: string, items: readonly unknown[]) => {
        serve(conversation, items);
        return (await gateway.listMessages(conversation, undefined, reader)).at(-1)?.replies;
      };

      it("rebuilds the options from the tool's stored output, as the live turn did", async () => {
        const items = turn(
          output('fc_7', '{"slots":["9:00","11:00"]}'),
          call('fc_7', 'find_slots', '{}'),
        );
        expect(await latestReplies('conv_t', items)).toEqual(['Book 9:00', 'Book 11:00']);
      });

      it('takes the last call that defined any', async () => {
        const items = turn(
          output('fc_c', '{"slots":[]}'),
          output('fc_b', '{"slots":["9:00"]}'),
          output('fc_a', 'null'),
          call('fc_c', 'find_slots', '{}'),
          call('fc_b', 'find_slots', '{}'),
          call('fc_a', 'fallback', '{}'),
        );
        expect(await latestReplies('conv_last', items)).toEqual(['Book 9:00']);
      });

      it('offers nothing for failed, unanswered or unknown calls', async () => {
        const failures = [
          '{"error":"The tool failed."}',
          '{"error":"The tool timed out."}',
          '{"error":"The tool returned too much data."}',
          '{"error":"Invalid arguments: ✖ Invalid input"}',
          '{"error":"Arguments were not valid JSON."}',
        ];
        for (const [index, failure] of failures.entries()) {
          const items = turn(output('fc_f', failure), call('fc_f', 'fallback', '{}'));
          expect(await latestReplies(`conv_f${index}`, items)).toBeUndefined();
        }
        expect(await latestReplies('conv_u', turn(call('fc_u', 'fallback', '{}')))).toBeUndefined();
        const unknown = turn(output('fc_x', 'null'), call('fc_x', 'removed_tool', '{}'));
        expect(await latestReplies('conv_x', unknown)).toBeUndefined();
      });

      it('still offers options for a result that only looks like an error', async () => {
        const items = turn(
          output('fc_e', '{"error":"No such order."}'),
          call('fc_e', 'fallback', '{}'),
        );
        expect(await latestReplies('conv_e', items)).toEqual(['Talk to a person']);
      });
    });
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
