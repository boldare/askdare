/**
 * Why stateless replay renders 4–6% more input tokens than the same turns inside a conversation
 * (results-turns). Runs 3 turns in both modes, then counts the next turn's input per variant.
 *
 *   node --env-file=.env probe-tokens.ts
 */
import { writeFile } from 'node:fs/promises';
import OpenAI, { toFile } from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
import pg from 'pg';
import { modelFamily, replay } from './openai-map.ts';
import { openaiConversationsStore } from './openai-store.ts';
import { DATABASE_URL, postgresStore } from './pg-store.ts';
import { INSTRUCTIONS, runTurn } from './turn.ts';

const MODEL = process.env['S7_MODEL'] ?? 'gpt-6.1-terra';
const client = new OpenAI({ maxRetries: 1, timeout: 120_000 });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
const pgStore = postgresStore(pool);
const oaStore = openaiConversationsStore(client);
const owner = { botId: 'spike-s7', owner: 'visitor:s7-tokens' };
const out: Record<string, unknown> = { model: MODEL };
const png = (() => {
  return Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
})();
const file = await client.files.create({ file: await toFile(png, 'dot.png', { type: 'image/png' }), purpose: 'user_data', expires_after: { anchor: 'created_at', seconds: 86_400 } });
const conv = await oaStore.create(owner);
const pgId = await pgStore.create(owner);
try {
  const script = [
    { text: 'Here is a photo of a scratch on my table. Is that covered?', fileIds: [file.id] },
    { text: 'What payment methods do you accept?', fileIds: [] },
    { text: 'Can you check order 51877?', fileIds: [] },
  ];
  for (const turn of script) {
    await runTurn({ client, model: MODEL, store: oaStore, conversationId: conv, safetyIdentifier: 's7-tokens', ...turn });
    await runTurn({ client, model: MODEL, store: pgStore, conversationId: pgId, safetyIdentifier: 's7-tokens', ...turn });
  }
  const next: ResponseInputItem = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Thanks!' }] };
  const context = await pgStore.context(pgId);
  if (context.kind !== 'items') throw new Error('items expected');
  const family = modelFamily(MODEL);
  const items = context.items;
  const count = async (input: ResponseInputItem[] | undefined, conversation?: string) =>
    (await client.responses.inputTokens.count({ model: MODEL, instructions: INSTRUCTIONS, ...(conversation ? { conversation } : {}), input: input ?? [next] })).input_tokens;
  const variants: Record<string, number> = {};
  variants['statelessFull'] = await count([...replay(items, family), next]);
  variants['statelessNoReasoning'] = await count([...replay(items.filter((i) => i.type !== 'native'), family), next]);
  variants['statelessNoImage'] = await count([...replay(items.map((i) => (i.type === 'message' ? { ...i, parts: i.parts.filter((p) => p.type !== 'file') } : i)), family), next]);
  variants['statelessNoPhase'] = await count([...replay(items.map((i) => (i.type === 'message' ? { ...i, phase: undefined } : i)) as typeof items, family), next]);
  // The conversation's own items, replayed statelessly: same rendering as the conversation?
  const listed: ResponseInputItem[] = [];
  for await (const item of client.conversations.items.list(conv, { order: 'asc', limit: 100 })) {
    const { id: _id, status: _s, ...rest } = item as unknown as Record<string, unknown>;
    listed.push(rest as unknown as ResponseInputItem);
  }
  out['conversationItems'] = listed.map((i) => ('type' in i ? i.type : 'message') + ('role' in i ? `:${i.role}` : ''));
  out['statelessItems'] = items.map((i) => (i.type === 'message' ? `message:${i.role}${i.phase ? `/${i.phase}` : ''}` : i.type));
  variants['conversationItemsReplayed'] = await count([...listed, next]).catch((e: unknown) => -1 * String(e).length);
  // Counting with `conversation` locks it for ~75 s (S5b), so it goes last.
  variants['conversation'] = await count(undefined, conv);
  out['variants'] = variants;
} finally {
  out['cleanup'] = {
    conversation: await client.conversations.delete(conv).then(() => 'deleted', (e: unknown) => String(e)),
    file: await client.files.delete(file.id).then(() => 'deleted', (e: unknown) => String(e)),
    pg: (await pgStore.delete(pgId)).fileIds,
  };
  await pool.end();
  await writeFile(new URL('./results-tokens.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 1));
}
