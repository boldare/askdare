/**
 * The ConversationStore contract against the real Conversations API. Never part of `pnpm test`; it
 * makes no model calls, only conversation and file requests, and deletes what it creates.
 *
 *   ASKDARE_CONTRACT_OPENAI=1 OPENAI_API_KEY=… pnpm smoke
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { ConversationStore } from '../conversations/port';
import { conversationStoreContract } from '../testing/conversation-store-contract';
import { createOpenAIClient } from './client';
import { openaiConversations } from './conversations';

const apiKey = process.env['OPENAI_API_KEY'];
const enabled = process.env['ASKDARE_CONTRACT_OPENAI'] === '1' && Boolean(apiKey);

/** A 1×1 PNG: OpenAI refuses unknown file IDs on append, so the contract needs real ones. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

if (enabled) {
  const client = createOpenAIClient({ apiKey: apiKey ?? '', maxRetries: 2, timeoutMs: 30_000 });
  const uploaded: string[] = [];
  const upload = async (): Promise<string> => {
    const file = await client.files.create({
      file: new File([PNG], 'dot.png', { type: 'image/png' }),
      purpose: 'user_data',
      expires_after: { anchor: 'created_at', seconds: 3_600 },
    });
    uploaded.push(file.id);
    return file.id;
  };
  const store = openaiConversations({ apiKey: apiKey ?? '' });
  // Every conversation the run creates, checked at the end: OpenAI can't list them, so one left
  // behind could never be found again.
  const created: string[] = [];
  const tracked: ConversationStore = {
    ...store,
    create: async (owner, signal) => {
      const id = await store.create(owner, signal);
      created.push(id);
      return id;
    },
  };
  afterAll(async () => {
    for (const id of uploaded) await client.files.delete(id).catch(() => undefined);
    const left: string[] = [];
    for (const id of created) {
      if ((await store.info(id)) === undefined) continue;
      await store.delete(id).catch(() => undefined);
      if ((await store.info(id)) !== undefined) left.push(id);
    }
    console.log(
      `contract run: ${created.length} conversations created, ${left.length} left behind${left.length ? `: ${left.join(', ')}` : ''}; ${uploaded.length} files deleted`,
    );
  });
  conversationStoreContract('openaiConversations', () => tracked, {
    describe,
    it,
    expect,
    kind: 'provider',
    pagingItems: 48,
    pageSize: 20,
    files: async () => [await upload(), await upload()],
    timeoutMs: 120_000,
  });
} else {
  describe.skip('openaiConversations (ConversationStore contract, live)', () => {
    it('needs ASKDARE_CONTRACT_OPENAI=1 and OPENAI_API_KEY', () => {});
  });
}
