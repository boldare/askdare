import type OpenAI from 'openai';
import { NotFoundError } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachedFileIds, deleteFiles, FILE_TTL_SECONDS } from './attachments';

type Item = Record<string, unknown>;

function clientWith(items: readonly Item[], onDelete?: (fileId: string) => Promise<unknown>) {
  const list = vi.fn((_conversationId: string, _options: unknown) => ({
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  }));
  const remove = vi.fn(onDelete ?? (async () => ({})));
  const client = {
    conversations: { items: { list } },
    files: { delete: remove },
  } as unknown as OpenAI;
  return { client, list, remove };
}

const user = (...content: Item[]): Item => ({ type: 'message', role: 'user', content });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FILE_TTL_SECONDS', () => {
  it('is 30 days', () => {
    expect(FILE_TTL_SECONDS).toBe(2_592_000);
  });
});

describe('attachedFileIds', () => {
  it("collects each file the visitor attached, once, from the user's messages only", async () => {
    const { client, list } = clientWith([
      user(
        { type: 'input_text', text: 'look' },
        { type: 'input_image', file_id: 'file-img' },
        { type: 'input_file', file_id: 'file-pdf' },
      ),
      user({ type: 'input_image', file_id: 'file-img' }),
      user({ type: 'input_image', image_url: 'https://e.com/a.png', file_id: null }),
      { type: 'message', role: 'assistant', content: [{ type: 'input_file', file_id: 'file-x' }] },
      { type: 'file_search_call', id: 'fs_1' },
    ]);
    expect(await attachedFileIds(client, 'conv_1')).toEqual(['file-img', 'file-pdf']);
    expect(list).toHaveBeenCalledWith('conv_1', { limit: 100 });
  });

  it('stops scanning after 1000 items', async () => {
    const items = Array.from({ length: 1_005 }, (_, index) =>
      user({ type: 'input_file', file_id: `file-${index}` }),
    );
    const ids = await attachedFileIds(clientWith(items).client, 'conv_1');
    expect(ids).toHaveLength(1_000);
    expect(ids.at(-1)).toBe('file-999');
  });
});

describe('deleteFiles', () => {
  it('deletes every file, five at a time', async () => {
    let running = 0;
    let most = 0;
    const { client, remove } = clientWith([], async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
    });
    const ids = Array.from({ length: 12 }, (_, index) => `file-${index}`);
    await deleteFiles(client, ids);
    expect(remove.mock.calls.map(([id]) => id)).toEqual(ids);
    expect(most).toBe(5);
  });

  it('ignores files that are already gone and logs other failures by ID only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, remove } = clientWith([], async (fileId) => {
      if (fileId === 'file-gone') {
        throw new NotFoundError(404, undefined, 'No such file', new Headers());
      }
      if (fileId === 'file-broken') throw new Error('500 secret details');
      return {};
    });
    await expect(
      deleteFiles(client, ['file-gone', 'file-broken', 'file-ok']),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      '[askdare] could not delete an attachment file:',
      'file-broken',
    );
  });

  it('does nothing without files', async () => {
    const { client, remove } = clientWith([]);
    await deleteFiles(client, []);
    expect(remove).not.toHaveBeenCalled();
  });
});
