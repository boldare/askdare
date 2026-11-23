import {
  type ConversationStore,
  type StoredItem,
  VersionConflictError,
} from '../conversations/port';
import type { ContractRunner } from './runner';

export interface ConversationStoreContractOptions extends ContractRunner {
  /**
   * `items` (default) for stores that keep the items themselves and replay them; `provider` for
   * stores whose model provider keeps them (OpenAI Conversations), which have no versions.
   */
  readonly kind?: 'items' | 'provider' | undefined;
  /** Items written for the paging test. Default 250; smaller for stores with network costs. */
  readonly pagingItems?: number | undefined;
  /** Page size in the paging test. Default 100. */
  readonly pageSize?: number | undefined;
  /** Two real file IDs, for stores that check them on append (OpenAI refuses unknown ones). */
  readonly files?: (() => Promise<readonly [string, string]>) | undefined;
  /** An ID the store has never issued. Default: a random UUID, or `conv_does_not_exist` for `provider`. */
  readonly unknownId?: string | undefined;
  /** Per-test timeout in milliseconds, for stores behind a network. Default: the runner's. */
  readonly timeoutMs?: number | undefined;
}

const OWNER = { botId: 'contract-bot', owner: 'visitor:contract' } as const;

let counter = 0;
const itemId = (): string => {
  counter += 1;
  return `itm_contract_${Date.now()}_${counter}`;
};
const user = (text: string, fileId?: string): StoredItem => ({
  id: itemId(),
  type: 'message',
  role: 'user',
  parts: [
    { type: 'text', text },
    ...(fileId ? [{ type: 'file' as const, fileId, kind: 'image' as const }] : []),
  ],
});
const assistant = (text: string): StoredItem => ({
  id: itemId(),
  type: 'message',
  role: 'assistant',
  parts: [{ type: 'text', text }],
});
/** One turn with a tool call: question, call, output, answer. */
const turn = (n: number): StoredItem[] => {
  const callId = `call_${n}_${Date.now()}_${counter}`;
  return [
    user(`question ${n}`),
    { id: itemId(), type: 'call', callId, name: 'lookup_order', arguments: `{"order":"${n}"}` },
    { id: itemId(), type: 'call_output', callId, output: `{"status":"shipped","n":${n}}` },
    assistant(`answer ${n}`),
  ];
};
/** What every store keeps: IDs may be the store's own (OpenAI assigns them), positions differ. */
const comparable = (item: StoredItem): Record<string, unknown> => {
  const {
    id: _id,
    seq: _seq,
    at: _at,
    ...rest
  } = item as StoredItem & {
    seq?: number;
    at?: number;
  };
  return rest;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const failure = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return undefined;
};

/**
 * The behaviour every `ConversationStore` must have (ADR-0024). Run it from your store's tests with
 * your runner's `describe`, `it` and `expect`:
 *
 * ```ts
 * import { conversationStoreContract } from '@boldare/askdare/testing';
 * import { describe, expect, it } from 'vitest';
 *
 * conversationStoreContract('my store', () => myStore(), { describe, it, expect });
 * ```
 *
 * Every conversation a test creates is deleted when it ends, also when it fails.
 */
export function conversationStoreContract(
  name: string,
  createStore: () => ConversationStore,
  options: ConversationStoreContractOptions,
): void {
  const { describe, it, expect } = options;
  const items = (options.kind ?? 'items') === 'items';

  /** A test with a fresh store and a `create` whose conversations are always deleted after it. */
  const test = (
    title: string,
    body: (store: ConversationStore, create: () => Promise<string>) => Promise<void>,
  ): void => {
    it(
      title,
      async () => {
        const store = createStore();
        const created: string[] = [];
        const create = async (): Promise<string> => {
          const id = await store.create(OWNER);
          created.push(id);
          return id;
        };
        try {
          await body(store, create);
        } finally {
          for (const id of created) await store.delete(id).catch(() => undefined);
        }
      },
      options.timeoutMs,
    );
  };

  describe(`${name} (ConversationStore contract)`, () => {
    test('creates a conversation that knows its bot and owner', async (store, create) => {
      const id = await create();
      const info = await store.info(id);
      expect(info?.id).toBe(id);
      expect(info?.botId).toBe(OWNER.botId);
      expect(info?.owner).toBe(OWNER.owner);
    });

    test('answers an unknown ID with undefined, never another conversation', async (store, create) => {
      await create();
      const unknown = options.unknownId ?? (items ? crypto.randomUUID() : 'conv_does_not_exist');
      expect(await store.info(unknown)).toBe(undefined);
    });

    test('keeps appended items in order and as given', async (store, create) => {
      const id = await create();
      const written = [...turn(1), ...turn(2)];
      await store.append(id, written.slice(0, 4));
      await store.append(id, written.slice(4));
      const page = await store.page(id, { limit: 100 });
      expect(page.items.map(comparable)).toEqual(written.map(comparable));
      expect(page.before).toBe(undefined);
    });

    test('keeps conversations apart', async (store, create) => {
      const a = await create();
      const b = await create();
      await store.append(a, turn(1));
      expect((await store.page(b)).items.length).toBe(0);
    });

    test('pages back through a long conversation, each item once', async (store, create) => {
      const id = await create();
      const total = options.pagingItems ?? 250;
      const written: StoredItem[] = [];
      for (let n = 0; written.length < total; n += 1) written.push(...turn(n));
      for (let index = 0; index < written.length; index += 20) {
        await store.append(id, written.slice(index, index + 20));
      }
      const seen: StoredItem[] = [];
      let before: string | undefined;
      let pages = 0;
      do {
        const page = await store.page(id, {
          limit: options.pageSize ?? 100,
          ...(before === undefined ? {} : { before }),
        });
        seen.unshift(...page.items);
        before = page.before;
        pages += 1;
      } while (before !== undefined && pages < 1_000);
      expect(seen.map(comparable)).toEqual(written.map(comparable));
    });

    test('deletes a conversation and returns the files its visitor attached', async (store, create) => {
      const id = await create();
      const [one, two] = options.files
        ? await options.files()
        : (['file-contract-1', 'file-contract-2'] as const);
      await store.append(id, [user('look', one), assistant('seen'), user('again', two)]);
      const { fileIds } = await store.delete(id);
      expect([...fileIds].sort()).toEqual([one, two].sort());
      expect(await store.info(id)).toBe(undefined);
      // Deleting twice is no error: "start a new conversation" may race a retention sweep.
      expect((await store.delete(id)).fileIds).toEqual([]);
    });

    if (!items) {
      test('returns a provider reference as the turn context', async (store, create) => {
        const id = await create();
        expect((await store.context(id)).kind).toBe('provider');
      });
      return;
    }

    test('replays everything, with the version, as the turn context', async (store, create) => {
      const id = await create();
      const version = await store.append(id, turn(1));
      expect(version).toBe(4);
      expect((await store.info(id))?.version).toBe(4);
      const context = await store.context(id);
      expect(context.kind).toBe('items');
      expect(context.version).toBe(version);
      expect(context.kind === 'items' ? context.items.length : -1).toBe(4);
    });

    test('cuts the replay window at a visitor message, never inside a turn', async (store, create) => {
      const id = await create();
      await store.append(id, [...turn(1), ...turn(2), ...turn(3)]);
      for (const maxItems of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
        const context = await store.context(id, { maxItems });
        if (context.kind !== 'items') throw new Error('An item store returned a provider context.');
        expect(context.items.length <= maxItems).toBe(true);
        const first = context.items[0];
        if (first) expect(first.type === 'message' && first.role === 'user').toBe(true);
        const calls = new Set(
          context.items.flatMap((item) => (item.type === 'call' ? [item.callId] : [])),
        );
        for (const item of context.items) {
          if (item.type === 'call_output') expect(calls.has(item.callId)).toBe(true);
        }
      }
    });

    test('refuses an append when another turn wrote first, and writes nothing', async (store, create) => {
      const id = await create();
      const version = await store.append(id, turn(1));
      await store.append(id, [user('from another tab')], { expect: version });
      const error = await failure(store.append(id, [assistant('stale')], { expect: version }));
      expect(error).toBeInstanceOf(VersionConflictError);
      expect((await store.page(id)).items.length).toBe(5);
    });

    test('lets exactly one of two concurrent appends at the same version win', async (store, create) => {
      const id = await create();
      const version = await store.append(id, [user('hi')]);
      const results = await Promise.allSettled([
        store.append(id, [assistant('a')], { expect: version }),
        store.append(id, [assistant('b')], { expect: version }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1);
      expect((await store.page(id)).items.length).toBe(2);
    });

    test('refuses an item ID used twice in a conversation, and writes nothing', async (store, create) => {
      const id = await create();
      const item = user('once');
      await store.append(id, [item]);
      expect(await failure(store.append(id, [assistant('new'), item]))).toBeInstanceOf(Error);
      expect((await store.page(id)).items.length).toBe(1);
    });

    test('returns copies: changing a returned item changes nothing stored', async (store, create) => {
      const id = await create();
      await store.append(id, [user('original')]);
      const [read] = (await store.page(id)).items;
      const part = read?.type === 'message' ? read.parts[0] : undefined;
      if (part?.type === 'text') (part as { text: string }).text = 'changed';
      const [again] = (await store.page(id)).items;
      expect(again?.type === 'message' ? again.parts[0] : undefined).toEqual({
        type: 'text',
        text: 'original',
      });
    });

    test('sweeps idle conversations only', async (store, create) => {
      if (!store.sweep) return;
      const idle = await create();
      await store.append(idle, [user('old')]);
      await sleep(300);
      const cutoff = Date.now();
      await sleep(300);
      const active = await create();
      await store.append(active, [user('new')]);
      const swept = new Set((await store.sweep(cutoff, 10_000)).map((each) => each.id));
      expect(swept.has(idle)).toBe(true);
      expect(swept.has(active)).toBe(false);
      expect(await store.info(idle)).toBe(undefined);
      expect((await store.info(active))?.id).toBe(active);
    });
  });
}
