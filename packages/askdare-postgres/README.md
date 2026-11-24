# @boldare/askdare-postgres

Keep [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare)'s data in your own Postgres.

**[askdare website and docs](https://askdare.vercel.app)** · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-postgres)

> **Work in progress.** The conversation store is here; the pgvector knowledge index arrives in a later release of askdare 0.6.

## Install

```bash
npm install @boldare/askdare-postgres
```

`pg` comes with it. Any hosted or own Postgres works, such as Neon, Supabase or Heroku Postgres; askdare is tested on Postgres 17. The knowledge index will also need the [pgvector](https://github.com/pgvector/pgvector) extension.

## Migrate

askdare keeps its schema in code and never changes the database while it serves requests. Create or upgrade the schema with `migrate`, once per deployment, before the new code goes live:

```bash
npx askdare-postgres migrate
```

It reads `DATABASE_URL` from the environment, or from `.env.local` and then `.env` in the current folder. Run it as a release step:

- **Vercel:** in the build command, such as `askdare-postgres migrate && next build`. Preview builds then migrate the database their own `DATABASE_URL` points to.
- **Heroku:** in the `Procfile`, `release: npx askdare-postgres migrate`.
- **Anywhere else:** from your deployment script, or once by hand.

Or call it from your own script:

```ts
import { migrate } from '@boldare/askdare-postgres';

const report = await migrate(); // DATABASE_URL; or migrate({ url }) or migrate({ pool })
console.log(report.applied);
```

`migrate` is idempotent: when the schema is up to date it changes nothing. Concurrent runs wait for each other. Each step runs in a transaction, so a failed one leaves the previous version in place. A database that a newer version of this package migrated makes it stop before changing anything.

The database user that migrates needs the right to create tables. The app's own user then only needs `select`, `insert`, `update` and `delete` on them.

## Conversations

`postgresConversations()` keeps every conversation in your database instead of at OpenAI. Turns then replay the stored items with `store: false`, so nothing of the conversation stays at OpenAI beyond its 30-day abuse monitoring of requests: zero-data-retention organisations and EU-only setups can use askdare.

```ts
// app/api/chat/[...askdare]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { postgresConversations } from '@boldare/askdare-postgres';
import { supportBot } from '@/bots/support';

export const { GET, POST, DELETE } = createChatHandler({
  bots: [supportBot],
  conversations: postgresConversations(), // DATABASE_URL; or { url } or { pool }
});
```

Run [`migrate`](#migrate) first: the store never creates or changes tables itself. It connects on first use, so a build without `DATABASE_URL` still works, and `askdare doctor` reports an unreachable database or a schema that needs `migrate`.

What it stores, in `askdare_conversations` and `askdare_conversation_items`:

- one row per conversation: its bot, its owner (`visitor:<id>` or `user:<key>`), when it was created and last written;
- one row per item, as `jsonb`: the visitor's messages (with the file IDs of their attachments), the answers with their citations, tool calls and their outputs, guardrail notes and the model's encrypted reasoning.

That is personal data: choose a retention period and [sweep](#retention) old conversations. Items are written once and never changed. A NUL character or a lone UTF-16 surrogate, which Postgres can't store, is kept as U+FFFD. The store logs nothing.

### Retention

`sweep(idleSince, limit)` deletes up to `limit` conversations with no new message since `idleSince` (epoch milliseconds) and returns their IDs with the files their visitors attached. Idle time counts from the database's clock (each append's `now()`), so keep the app server's clock in sync with it when the retention is short. Sweepers on several instances never block each other or a turn in progress, and never delete the same conversation twice.

askdare can't schedule work, so call it from a cron route or a scheduled job, and delete the returned files as `DELETE /conversation` does. Attachments also expire at OpenAI 30 days after upload, so with a retention of 30 days or more they are already gone; for a shorter one, delete them. If you keep transcripts or ratings elsewhere (such as from `onTranscript`), delete them by the same conversation IDs.

**Vercel:** a cron route, protected by the `CRON_SECRET` Vercel sends as a bearer token.

```ts
// app/api/cron/sweep-conversations/route.ts
import { postgresConversations } from '@boldare/askdare-postgres';
import OpenAI from 'openai';

const RETENTION_DAYS = 30;
const BATCH = 100;
const conversations = postgresConversations();
const openai = new OpenAI();

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const idleSince = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let swept = 0;
  // A bounded number of batches per run; the next run continues.
  for (let batch = 0; batch < 20; batch += 1) {
    const deleted = await conversations.sweep(idleSince, BATCH);
    swept += deleted.length;
    const fileIds = deleted.flatMap((conversation) => conversation.fileIds);
    await Promise.allSettled(fileIds.map((fileId) => openai.files.delete(fileId)));
    if (deleted.length < BATCH) break;
  }
  return Response.json({ swept });
}
```

In `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/sweep-conversations", "schedule": "0 3 * * *" }] }
```

Add `openai` to your dependencies for the file deletion, and let the route through your `proxy.ts` if it has one.

**Heroku:** a script run daily by [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler), as `node scripts/sweep-conversations.mjs`. It ends its own pool, so the dyno exits as soon as it is done; add `pg` and `openai` to your dependencies for it.

```js
// scripts/sweep-conversations.mjs
import { postgresConversations } from '@boldare/askdare-postgres';
import OpenAI from 'openai';
import pg from 'pg';

const RETENTION_DAYS = 30;
const BATCH = 100;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const conversations = postgresConversations({ pool });
const openai = new OpenAI();

try {
  const idleSince = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let swept = 0;
  for (;;) {
    const deleted = await conversations.sweep(idleSince, BATCH);
    swept += deleted.length;
    const fileIds = deleted.flatMap((conversation) => conversation.fileIds);
    await Promise.allSettled(fileIds.map((fileId) => openai.files.delete(fileId)));
    if (deleted.length < BATCH) break;
  }
  console.log(`Swept ${swept} conversations.`);
} finally {
  await pool.end();
}
```

## Connection options

| Option | Default | What it does |
| --- | --- | --- |
| `url` | `process.env.DATABASE_URL` | A connection string, such as `postgres://host:5432/db?sslmode=require`; the user and password go in the URL or in `PGUSER` and `PGPASSWORD`. |
| `pool` | a pool made from `url` | An existing `pg` `Pool`, or one with the same methods. askdare never ends a pool you pass. |

Tables are created without a schema name, so the connection's `search_path` decides where they go. Every table name starts with `askdare_`.

## Requirements

`@boldare/askdare` in the range of its peer dependency (each askdare release brings a matching add-on release), Postgres (tested on 17), and Node.js 22 or later.

## Contributing

The tests run against Postgres 17 with pgvector. Start it with the `docker-compose.yml` in this folder (port 54329) and set `ASKDARE_POSTGRES_TEST_URL`:

```bash
docker compose -f packages/askdare-postgres/docker-compose.yml up -d --wait
```

```bash
ASKDARE_POSTGRES_TEST_URL=postgres://askdare@127.0.0.1:54329/askdare pnpm test
```

Without the variable, the Postgres tests are skipped locally. In CI they always run.

## License

MIT © Boldare
