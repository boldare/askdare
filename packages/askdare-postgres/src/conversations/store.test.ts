import type { StoredItem } from '@boldare/askdare';
import { conversationStoreContract } from '@boldare/askdare/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate } from '../schema/migrate';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';
import { CONVERSATIONS_TABLE } from './schema';
import { postgresConversations } from './store';

const OWNER = { botId: 'support', owner: 'visitor:abc' } as const;

let counter = 0;
const user = (text: string, ...fileIds: string[]): StoredItem => {
  counter += 1;
  return {
    id: `itm_user_${counter}`,
    type: 'message',
    role: 'user',
    parts: [
      { type: 'text', text },
      ...fileIds.map((fileId) => ({ type: 'file' as const, fileId, kind: 'pdf' as const })),
    ],
  };
};
const assistant = (text: string): StoredItem => {
  counter += 1;
  return {
    id: `itm_assistant_${counter}`,
    type: 'message',
    role: 'assistant',
    parts: [{ type: 'text', text }],
  };
};

describe('postgresConversations without a database', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('can be created without DATABASE_URL, so a build that loads the route works', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const store = postgresConversations();
    expect(store.name).toBe('postgres');
    const [check] = await store.diagnose();
    expect(check?.status).toBe('fail');
    await expect(store.create(OWNER)).rejects.toThrow('Set DATABASE_URL');
  });

  it("reports a database it can't reach by its error code only", async () => {
    // Nothing listens on port 1; the URL has no credentials.
    const store = postgresConversations({ url: 'postgres://127.0.0.1:1/askdare' });
    const checks = await store.diagnose();
    expect(checks).toEqual([
      {
        status: 'fail',
        title: "Postgres conversation store: the database can't be reached (ECONNREFUSED).",
        fix: expect.stringContaining('DATABASE_URL'),
      },
    ]);
  });

  it('answers IDs it never issues without asking the database', async () => {
    const store = postgresConversations({ url: 'postgres://127.0.0.1:1/askdare' });
    expect(await store.info('conv_123')).toBe(undefined);
    expect(await store.delete("'; drop table askdare_conversations; --")).toEqual({ fileIds: [] });
    await expect(store.context('conv_123')).rejects.toThrow('does not exist');
    await expect(store.page('conv_123')).rejects.toThrow('does not exist');
    await expect(store.append('conv_123', [user('hi')])).rejects.toThrow('does not exist');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('postgresConversations against Postgres', () => {
  let schema: TestSchema;

  beforeAll(async () => {
    schema = await createTestSchema();
    await migrate({ pool: schema.pool });
  });

  afterAll(async () => {
    await schema.drop();
  });

  conversationStoreContract(
    'postgresConversations',
    () => postgresConversations({ pool: schema.pool }),
    {
      describe,
      it,
      expect,
    },
  );

  const store = () => postgresConversations({ pool: schema.pool });

  /** Moves a conversation's last append back in time, instead of sleeping in the test. */
  const age = async (id: string, days: number): Promise<void> => {
    await schema.pool.query(
      `update ${CONVERSATIONS_TABLE} set updated_at = now() - make_interval(days => $2) where id = $1`,
      [id, days],
    );
  };

  describe('sweep', () => {
    const dayAgo = (): number => Date.now() - 24 * 60 * 60 * 1000;

    it('lets concurrent sweepers delete each idle conversation once, with its files', async () => {
      const conversations = store();
      const idle: string[] = [];
      for (let n = 0; n < 8; n += 1) {
        const id = await conversations.create(OWNER);
        await conversations.append(id, [user(`old ${n}`, `file-${n}`), assistant('done')]);
        await age(id, 40);
        idle.push(id);
      }
      const recent = await conversations.create(OWNER);
      await conversations.append(recent, [user('new', 'file-recent')]);

      const results = await Promise.all(
        Array.from({ length: 4 }, () => store().sweep(dayAgo(), 3)),
      );
      // Sweepers that found nothing left are fine; whatever they took, they took alone.
      let swept = results.flat();
      while (swept.length < idle.length) {
        const more = await conversations.sweep(dayAgo(), 3);
        if (more.length === 0) break;
        swept = [...swept, ...more];
      }
      expect(swept.map((each) => each.id).sort()).toEqual([...idle].sort());
      for (const [n, id] of idle.entries()) {
        expect(swept.find((each) => each.id === id)?.fileIds).toEqual([`file-${n}`]);
        expect(await conversations.info(id)).toBe(undefined);
      }
      expect((await conversations.info(recent))?.id).toBe(recent);
      expect(await conversations.sweep(dayAgo(), 100)).toEqual([]);
      await conversations.delete(recent);
    });

    it('skips a conversation a turn is appending to, and never blocks on it', async () => {
      const conversations = store();
      const live = await conversations.create(OWNER);
      await conversations.append(live, [user('hello')]);
      const other = await conversations.create(OWNER);
      await age(live, 40);
      await age(other, 40);

      // A turn's append in flight: it holds the row lock until it commits.
      const turn = await schema.pool.connect();
      try {
        await turn.query('begin');
        await turn.query(`select version from ${CONVERSATIONS_TABLE} where id = $1 for update`, [
          live,
        ]);
        const swept = await Promise.all([
          conversations.sweep(dayAgo(), 100),
          store().sweep(dayAgo(), 100),
        ]);
        expect(swept.flat().map((each) => each.id)).toEqual([other]);
        await turn.query(`update ${CONVERSATIONS_TABLE} set updated_at = now() where id = $1`, [
          live,
        ]);
        await turn.query('commit');
      } finally {
        turn.release();
      }

      // The append made it active again, so the next sweep keeps it too.
      expect(await conversations.sweep(dayAgo(), 100)).toEqual([]);
      expect((await conversations.info(live))?.version).toBe(1);
      await conversations.delete(live);
    });

    it('makes a turn that appends after the sweep find the conversation gone', async () => {
      const conversations = store();
      const id = await conversations.create(OWNER);
      const version = await conversations.append(id, [user('hi')]);
      await age(id, 40);
      expect((await conversations.sweep(dayAgo(), 10)).map((each) => each.id)).toEqual([id]);
      await expect(
        conversations.append(id, [assistant('late')], { expect: version }),
      ).rejects.toThrow('does not exist');
    });

    it('takes the oldest conversations first, up to the limit', async () => {
      const conversations = store();
      const oldest = await conversations.create(OWNER);
      const older = await conversations.create(OWNER);
      await age(oldest, 90);
      await age(older, 60);
      expect((await conversations.sweep(dayAgo(), 1)).map((each) => each.id)).toEqual([oldest]);
      expect(await conversations.sweep(dayAgo(), 0)).toEqual([]);
      expect((await conversations.sweep(dayAgo(), 1)).map((each) => each.id)).toEqual([older]);
    });
  });

  it('reports each attached file once, and only from visitor messages', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    await conversations.append(id, [
      user('look', 'file-a', 'file-b'),
      {
        id: 'itm_assistant_file',
        type: 'message',
        role: 'assistant',
        parts: [{ type: 'file', fileId: 'file-generated', kind: 'image' }],
      },
      user('again', 'file-a'),
    ]);
    expect([...(await conversations.delete(id)).fileIds].sort()).toEqual(['file-a', 'file-b']);
  });

  it('stores NUL characters and lone surrogates as U+FFFD instead of failing the turn', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    const output = 'a\u0000b \ud800 c\udc00 😀';
    await conversations.append(id, [
      user('before'),
      { id: 'itm_call', type: 'call', callId: 'call_1', name: 'fetch_page', arguments: '{}' },
      { id: 'itm_output', type: 'call_output', callId: 'call_1', output },
    ]);
    const { items } = await conversations.page(id);
    expect(items.at(-1)).toMatchObject({ output: 'a�b � c� 😀' });
    await conversations.delete(id);
  });

  it('keeps native items as given, with their positions and times', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    const before = Date.now();
    const native: StoredItem = {
      id: 'itm_reasoning',
      type: 'native',
      provider: 'openai',
      family: 'gpt-6',
      data: { type: 'reasoning', encrypted_content: 'gAAAA…', summary: [], nested: { n: 1.5 } },
    };
    await conversations.append(id, [user('hi'), native]);
    const context = await conversations.context(id);
    if (context.kind !== 'items') throw new Error('Expected items.');
    expect(context.items.map((item) => item.seq)).toEqual([1, 2]);
    expect(context.items[1]).toEqual({ ...native, seq: 2, at: expect.any(Number) });
    const at = context.items[1]?.at ?? 0;
    expect(at).toBeGreaterThanOrEqual(before - 1_000);
    expect((await conversations.info(id))?.updatedAt).toBe(at);
    await conversations.delete(id);
  });

  it('refuses a cursor it never issued', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    for (const before of ['0', '-1', '1e3', 'abc', '99999999999999999']) {
      await expect(conversations.page(id, { before })).rejects.toThrow('Invalid page cursor');
    }
    await conversations.delete(id);
  });

  it('takes a non-finite maxItems as no limit, and refuses an idleSince no Date can hold', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    await conversations.append(id, [user('hi'), assistant('hello')]);
    for (const maxItems of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const context = await conversations.context(id, { maxItems });
      expect(context.kind === 'items' ? context.items.length : -1).toBe(2);
    }
    await expect(conversations.sweep(1e20, 10)).rejects.toThrow('epoch milliseconds');
    await conversations.delete(id);
  });

  it('returns an empty window for maxItems 0, with the version', async () => {
    const conversations = store();
    const id = await conversations.create(OWNER);
    await conversations.append(id, [user('hi'), assistant('hello')]);
    expect(await conversations.context(id, { maxItems: 0 })).toEqual({
      kind: 'items',
      items: [],
      version: 2,
    });
    await conversations.delete(id);
  });

  it('answers an unknown conversation without inventing one', async () => {
    const conversations = store();
    const unknown = crypto.randomUUID();
    await expect(conversations.context(unknown)).rejects.toThrow('does not exist');
    await expect(conversations.page(unknown)).rejects.toThrow('does not exist');
    await expect(conversations.append(unknown, [user('hi')])).rejects.toThrow('does not exist');
    expect(await conversations.delete(unknown)).toEqual({ fileIds: [] });
  });

  it('honours an aborted signal before touching the database', async () => {
    const signal = AbortSignal.abort();
    await expect(store().create(OWNER, signal)).rejects.toThrow();
    await expect(store().context(crypto.randomUUID(), { signal })).rejects.toThrow();
    await expect(store().sweep(Date.now(), 10, signal)).rejects.toThrow();
  });

  describe('diagnose', () => {
    it('reports the schema version after migrate', async () => {
      expect(await store().diagnose()).toEqual([
        { status: 'ok', title: 'Postgres conversation store: schema version 1.' },
      ]);
    });

    it('asks for migrate on a database without the schema', async () => {
      const empty = await createTestSchema();
      try {
        const [check] = await postgresConversations({ pool: empty.pool }).diagnose();
        expect(check?.status).toBe('fail');
        expect(check?.fix).toContain('npx askdare-postgres migrate');
      } finally {
        await empty.drop();
      }
    });
  });
});
