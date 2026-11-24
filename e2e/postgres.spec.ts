import { migrate } from '@boldare/askdare-postgres';
import { expect, type Locator, test } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL, E2E_SCHEMA, TEST_DATABASE_URL } from './support/database';

// A chat whose conversations live in Postgres (postgresConversations from @boldare/askdare-postgres):
// each turn replays the stored items to the model with `store: false`, and the mocked OpenAI API
// keeps nothing. The site serves this bot only in the end-to-end tests (app/api/e2e-postgres).
const CHAT = 'http://localhost:3100/api/e2e-postgres/embed/postgres';
const BOT = 'postgres';

if (!E2E_DATABASE_URL && process.env['CI']) {
  throw new Error(
    'ASKDARE_POSTGRES_TEST_URL is not set; CI must run the Postgres end-to-end test.',
  );
}
test.skip(
  !E2E_DATABASE_URL,
  'Set ASKDARE_POSTGRES_TEST_URL (packages/askdare-postgres/docker-compose.yml).',
);

let db: pg.Pool;

test.beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await admin.query(`create schema if not exists ${E2E_SCHEMA}`);
  } finally {
    await admin.end();
  }
  // As a site does on deploy: askdare never migrates at request time.
  await migrate({ url: E2E_DATABASE_URL, parts: ['conversations'] });
  db = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
});

test.afterAll(async () => {
  await db?.end();
});

/** The bot's conversations in the database. */
async function conversationIds(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'select id::text as id from askdare_conversations where bot_id = $1',
    [BOT],
  );
  return rows.map((row) => row.id);
}

/** A conversation's stored items, oldest first, as `type` or `type:role`. */
async function storedItems(conversation: string): Promise<string[]> {
  const { rows } = await db.query<{ type: string; role: string | null }>(
    `select type, item->>'role' as role from askdare_conversation_items
     where conversation_id = $1 order by seq`,
    [conversation],
  );
  return rows.map((row) => (row.role ? `${row.type}:${row.role}` : row.type));
}

async function ask(chat: Locator, text: string): Promise<Locator> {
  await chat.getByRole('textbox').fill(text);
  await chat.getByRole('textbox').press('Enter');
  const reply = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
  await expect(reply).toHaveAttribute('data-status', 'done');
  return reply;
}

test('keeps a stateless conversation in Postgres through a reload, a tool call and its deletion', async ({
  page,
}) => {
  const before = new Set(await conversationIds());
  await page.goto(CHAT);
  const chat = page.locator('body');
  await expect(chat.getByRole('heading', { name: 'Kept in your own database' })).toBeVisible();

  const first = await ask(chat, 'Remember the blue door');
  await expect(first).toContainText(
    'You said: Remember the blue door (stateless, visitor message 1)',
  );
  const created = (await conversationIds()).filter((id) => !before.has(id));
  expect(created).toHaveLength(1);
  const conversation = created[0] ?? '';
  expect(await storedItems(conversation)).toEqual(['message:user', 'message:assistant']);

  // The history comes back from the database.
  await page.reload();
  const messages = chat.locator('[data-ask-part="message"]');
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toHaveText('Remember the blue door');
  await expect(messages.nth(1)).toContainText('(stateless, visitor message 1)');

  // The next turn replays the stored history (the model sees the visitor's second message) and
  // stores the clock's call and output with the answer.
  const next = await ask(chat, 'What time is it? [card]');
  await expect(next).toContainText(
    'You said: What time is it? [card] (stateless, visitor message 2)',
  );
  expect(await storedItems(conversation)).toEqual([
    'message:user',
    'message:assistant',
    'message:user',
    'call',
    'call_output',
    'message:assistant',
  ]);
  await page.reload();
  await expect(messages).toHaveCount(4);
  await expect(messages.nth(2)).toHaveText('What time is it? [card]');

  await chat.getByRole('button', { name: 'Start a new conversation' }).click();
  await chat.getByRole('alertdialog').getByRole('button', { name: 'Start new' }).click();
  await expect(messages).toHaveCount(0);
  expect(await conversationIds()).not.toContain(conversation);
  expect(await storedItems(conversation)).toEqual([]);
});
