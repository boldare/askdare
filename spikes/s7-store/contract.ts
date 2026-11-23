/**
 * Draft of the shared suite every ConversationStore runs (question 8), like
 * `src/limits/store-contract.ts` for RateLimitStore. Written for node:test here; vitest in the library.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { type ConversationStore, type StoredItem, VersionConflict } from './port.ts';

export interface ContractOptions {
  /** Item stores replay and version; provider stores (OpenAI Conversations) don't. */
  readonly kind: 'items' | 'provider';
  /** Items for the paging test; small for stores with network costs. */
  readonly pagingItems?: number;
  readonly pageSize?: number;
  /** Real file IDs for stores that check them (OpenAI refuses unknown IDs on append). */
  readonly files?: () => Promise<readonly [string, string]>;
}

let counter = 0;
const id = (): string => `itm_contract_${Date.now()}_${(counter += 1)}`;
const user = (text: string, fileId?: string): StoredItem => ({
  id: id(),
  type: 'message',
  role: 'user',
  parts: [{ type: 'text', text }, ...(fileId ? [{ type: 'file' as const, fileId, kind: 'image' as const }] : [])],
});
const assistant = (text: string): StoredItem => ({ id: id(), type: 'message', role: 'assistant', parts: [{ type: 'text', text }] });
const turn = (n: number): StoredItem[] => {
  const callId = `call_${n}_${Date.now()}`;
  return [
    user(`question ${n}`),
    { id: id(), type: 'call', callId, name: 'lookup_order', arguments: `{"order":"${n}"}` },
    { id: id(), type: 'call_output', callId, output: `{"status":"shipped","n":${n}}` },
    assistant(`answer ${n}`),
  ];
};
/** What survives every store: ids may be the store's own (OpenAI assigns them). */
const comparable = (item: StoredItem) => {
  const { id: _id, ...rest } = item as StoredItem & { seq?: number; at?: number };
  const { seq: _seq, at: _at, ...plain } = rest as typeof rest & { seq?: number; at?: number };
  return plain;
};

export function conversationStoreContract(name: string, createStore: () => ConversationStore, options: ContractOptions): void {
  // Every conversation a test creates is deleted afterwards, also when the test fails: a provider
  // store can't list conversations, so a leaked one could never be found again.
  const created: { store: ConversationStore; id: string }[] = [];
  const create = (): ConversationStore => {
    const store = createStore();
    return {
      ...store,
      create: async (owner, signal) => {
        const id = await store.create(owner, signal);
        created.push({ store, id });
        return id;
      },
    };
  };
  after(async () => {
    for (const { store, id } of created) await store.delete(id).catch(() => undefined);
  });
  const owner = { botId: 'contract-bot', owner: 'visitor:contract' };
  const items = options.kind === 'items';

  describe(`${name} (ConversationStore contract)`, () => {
    it('creates a conversation that knows its bot and owner', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const info = await store.info(conversation);
      assert.equal(info?.botId, owner.botId);
      assert.equal(info?.owner, owner.owner);
      await store.delete(conversation);
    });

    it('answers unknown IDs with undefined, never another conversation', async () => {
      const store = create();
      assert.equal(await store.info(items ? '00000000-0000-4000-8000-000000000000' : 'conv_does_not_exist'), undefined);
    });

    it('keeps appended items in order and as given', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const written = [...turn(1), ...turn(2)];
      await store.append(conversation, written.slice(0, 4));
      await store.append(conversation, written.slice(4));
      const page = await store.page(conversation, { limit: 100 });
      assert.deepEqual(page.items.map(comparable), written.map(comparable));
      assert.equal(page.before, undefined);
      await store.delete(conversation);
    });

    it('keeps conversations apart', async () => {
      const store = create();
      const a = await store.create(owner);
      const b = await store.create(owner);
      await store.append(a, turn(1));
      assert.equal((await store.page(b)).items.length, 0);
      await store.delete(a);
      await store.delete(b);
    });

    it('pages back through long conversations, each item once', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const total = options.pagingItems ?? 250;
      const written: StoredItem[] = [];
      for (let n = 0; written.length < total; n += 1) written.push(...turn(n));
      for (let index = 0; index < written.length; index += 20) await store.append(conversation, written.slice(index, index + 20));
      const seen: StoredItem[] = [];
      let before: string | undefined;
      let pages = 0;
      do {
        const page = await store.page(conversation, { limit: options.pageSize ?? 100, ...(before ? { before } : {}) });
        seen.unshift(...page.items);
        before = page.before;
        pages += 1;
      } while (before && pages < 100);
      assert.deepEqual(seen.map(comparable), written.map(comparable));
      await store.delete(conversation);
    });

    it('deletes a conversation and returns the files its visitor attached', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const [one, two] = options.files ? await options.files() : (['file-contract-1', 'file-contract-2'] as const);
      await store.append(conversation, [user('look', one), assistant('seen'), user('again', two)]);
      const { fileIds } = await store.delete(conversation);
      assert.deepEqual([...fileIds].sort(), [one, two].sort());
      assert.equal(await store.info(conversation), undefined);
      // Deleting twice is not an error: "start a new conversation" may race a retention sweep.
      assert.deepEqual((await store.delete(conversation)).fileIds, []);
    });

    if (!items) {
      it('returns a provider reference as the turn context', async () => {
        const store = create();
        const conversation = await store.create(owner);
        const context = await store.context(conversation);
        assert.equal(context.kind, 'provider');
        await store.delete(conversation);
      });
      return;
    }

    it('replays everything, with the version, as the turn context', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const version = await store.append(conversation, turn(1));
      const context = await store.context(conversation);
      assert.equal(context.kind, 'items');
      assert.equal(context.version, version);
      assert.equal(version, 4);
      if (context.kind === 'items') assert.equal(context.items.length, 4);
      await store.delete(conversation);
    });

    it('cuts the replay window at a visitor message, never inside a turn', async () => {
      const store = create();
      const conversation = await store.create(owner);
      await store.append(conversation, [...turn(1), ...turn(2), ...turn(3)]);
      for (const maxItems of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
        const context = await store.context(conversation, { maxItems });
        assert.equal(context.kind, 'items');
        if (context.kind !== 'items') continue;
        assert.ok(context.items.length <= maxItems);
        const first = context.items[0];
        if (first) assert.ok(first.type === 'message' && first.role === 'user', `window of ${maxItems} starts with ${first.type}`);
        const calls = new Set(context.items.flatMap((item) => (item.type === 'call' ? [item.callId] : [])));
        for (const item of context.items) if (item.type === 'call_output') assert.ok(calls.has(item.callId), 'output without its call');
      }
      await store.delete(conversation);
    });

    it('refuses an append when another turn wrote first, and writes nothing', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const version = await store.append(conversation, turn(1));
      await store.append(conversation, [user('from another tab')], { expect: version });
      await assert.rejects(store.append(conversation, [assistant('stale')], { expect: version }), VersionConflict);
      assert.equal((await store.page(conversation)).items.length, 5);
      await store.delete(conversation);
    });

    it('lets exactly one of two concurrent appends at the same version win', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const version = await store.append(conversation, [user('hi')]);
      const results = await Promise.allSettled([
        store.append(conversation, [assistant('a')], { expect: version }),
        store.append(conversation, [assistant('b')], { expect: version }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await store.page(conversation)).items.length, 2);
      await store.delete(conversation);
    });

    it('rejects an item ID used twice in a conversation', async () => {
      const store = create();
      const conversation = await store.create(owner);
      const item = user('once');
      await store.append(conversation, [item]);
      await assert.rejects(store.append(conversation, [item]));
      await store.delete(conversation);
    });

    it('sweeps idle conversations only', async (t) => {
      const store = create();
      if (!store.sweep) return t.skip('no sweep');
      const idle = await store.create(owner);
      await store.append(idle, [user('old')]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const cutoff = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const active = await store.create(owner);
      await store.append(active, [user('new')]);
      const swept = new Set<string>();
      for (const each of await store.sweep(cutoff, 10_000)) swept.add(each.id);
      assert.ok(swept.has(idle));
      assert.ok(!swept.has(active));
      assert.notEqual(await store.info(active), undefined);
      await store.delete(active);
    });
  });
}
