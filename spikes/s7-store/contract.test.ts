/**
 *   node --env-file-if-exists=.env --test contract.test.ts
 * The OpenAI run needs OPENAI_API_KEY and S7_CONTRACT_OPENAI=1; it makes no model calls.
 */
import { after } from 'node:test';
import OpenAI from 'openai';
import pg from 'pg';
import { conversationStoreContract } from './contract.ts';
import { memoryStore } from './memory-store.ts';
import { openaiConversationsStore } from './openai-store.ts';
import { DATABASE_URL, migrate, postgresStore } from './pg-store.ts';

conversationStoreContract('memory', () => memoryStore(), { kind: 'items' });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
await migrate(pool);
after(() => pool.end());
conversationStoreContract('postgres', () => postgresStore(pool), { kind: 'items' });

if (process.env['S7_CONTRACT_OPENAI'] === '1') {
  const client = new OpenAI({ maxRetries: 2, timeout: 30_000 });
  conversationStoreContract('openai-conversations', () => openaiConversationsStore(client), { kind: 'provider', pagingItems: 48, pageSize: 20 });
}
