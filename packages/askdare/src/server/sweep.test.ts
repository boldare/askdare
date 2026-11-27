import { describe, expect, it } from 'vitest';
import { memoryAdminStore } from '../admin/memory';
import type { AdminStore } from '../admin/port';
import type { ConversationStore } from '../conversations/port';
import type { ModelGateway } from '../gateway';
import { adminWriter } from './admin-records';
import { createSweep } from './sweep';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-26T12:00:00Z');
const usage = {
  inputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
};

const turn = (conversationId: string, at: number) => ({
  bot: 'support',
  conversationId,
  visitor: 'v',
  at,
  source: 'chat' as const,
  model: 'm',
  durationMs: 1,
  outcome: 'completed' as const,
  usage,
  steps: 1,
  tools: [],
  citations: 0,
  newConversation: true,
  unanswered: false,
});

/** A store with `count` idle conversations, each with one file, and the calls made to it. */
function idleStore(count: number, calls: string[]): ConversationStore {
  let left = Array.from({ length: count }, (_, index) => `conv_${index}`);
  return {
    name: 'test',
    sweep: async (_idleSince: number, limit: number) => {
      const batch = left.slice(0, limit);
      left = left.slice(limit);
      calls.push(`sweep:${batch.length}`);
      return batch.map((id) => ({ id, fileIds: [`file-${id}`] }));
    },
  } as unknown as ConversationStore;
}

function setup(store: AdminStore, conversations: ConversationStore, calls: string[]) {
  const deleted: string[] = [];
  const gateway = {
    deleteFiles: async (ids: readonly string[]) => {
      calls.push(`files:${ids.length}`);
      deleted.push(...ids);
    },
  } as unknown as ModelGateway;
  const errors: string[] = [];
  const sweep = createSweep({
    conversations,
    gateway: () => gateway,
    admin: {
      writer: adminWriter(store, { transcripts: false, retentionDays: 30, onError: () => {} }),
      retentionDays: 30,
    },
    onError: (error) => errors.push(error.message),
    now: () => NOW,
  });
  return { sweep, deleted, errors };
}

describe('sweep()', () => {
  it('deletes swept conversations with their records and files, then old records', async () => {
    const calls: string[] = [];
    const store = memoryAdminStore();
    await store.recordTurn(turn('conv_0', NOW - DAY));
    await store.recordTurn(turn('conv_old', NOW - 40 * DAY));
    await store.recordTurn(turn('conv_new', NOW - DAY));
    const deleteRecords = store.deleteConversation.bind(store);
    store.deleteConversation = async (id, signal) => {
      calls.push(`admin:${id}`);
      await deleteRecords(id, signal);
    };
    const { sweep, deleted } = setup(store, idleStore(3, calls), calls);

    const result = await sweep();
    expect(result).toEqual({ conversations: 3, files: 3, records: 1, more: false });
    expect(calls).toEqual(['sweep:3', 'admin:conv_0', 'admin:conv_1', 'admin:conv_2', 'files:3']);
    expect(deleted).toEqual(['file-conv_0', 'file-conv_1', 'file-conv_2']);
    expect(await store.transcript('conv_new')).toEqual([]);
    const days = await store.days({ from: '2026-11-25', to: '2026-11-25' });
    // Daily rows stay: they hold no conversation (ADR-0032, decision 2).
    expect(days.turns).toHaveLength(1);
    const listed = await store.conversations({
      from: '2026-10-01',
      to: '2026-11-26',
      order: 'latest',
      limit: 10,
    });
    expect(listed.items.map((item) => item.conversationId)).toEqual(['conv_new']);
  });

  it('stops at the limit and says more is left', async () => {
    const calls: string[] = [];
    const { sweep } = setup(memoryAdminStore(), idleStore(60, calls), calls);
    const first = await sweep({ limit: 30 });
    expect(first).toMatchObject({ conversations: 30, more: true });
    expect(calls.filter((call) => call.startsWith('sweep'))).toEqual(['sweep:25', 'sweep:5']);
  });

  it('keeps going when an admin delete fails, and reports it by class name', async () => {
    const calls: string[] = [];
    const store = memoryAdminStore();
    store.deleteConversation = async () => {
      throw new RangeError('conv_1 content');
    };
    const { sweep, deleted, errors } = setup(store, idleStore(2, calls), calls);
    expect(await sweep()).toMatchObject({ conversations: 2, files: 2 });
    expect(deleted).toHaveLength(2);
    expect(errors[0]).toContain('RangeError');
    expect(errors[0]).not.toContain('content');
  });

  it("sweeps records by age only with a store that can't list conversations", async () => {
    const store = memoryAdminStore();
    await store.recordTurn(turn('conv_old', NOW - 40 * DAY));
    const { sweep } = setup(store, { name: 'openai' } as ConversationStore, []);
    expect(await sweep()).toEqual({ conversations: 0, files: 0, records: 1, more: false });
  });

  it('refuses a malformed limit', async () => {
    const { sweep } = setup(memoryAdminStore(), idleStore(0, []), []);
    await expect(sweep({ limit: 0 })).rejects.toThrow(TypeError);
  });
});
