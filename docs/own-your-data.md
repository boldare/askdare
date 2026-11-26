# Own your data

By default, askdare needs no database: OpenAI keeps the conversations, and the knowledge base is an OpenAI vector store. This guide moves a bot to your own Postgres, step by step, and says what that changes for privacy, cost and operations. It builds on the app that [`init`](getting-started.md) makes, with one bot in `askdare.config.ts` and the route in `app/api/chat/[...path]/route.ts`.

| Data | By default | After this guide |
| --- | --- | --- |
| Conversations: messages, answers, tool calls and results | OpenAI's Conversations API, until deleted | Your Postgres, as long as you keep them (`postgresConversations`) |
| Knowledge: documents, chunks, embeddings | An OpenAI vector store, searched with `file_search` | Your Postgres with pgvector, searched with `search_knowledge` (`pgvectorIndex`) |
| Answers being written, for resume | The server's memory | Upstash, shared by every instance (`upstashTurnLog`) |
| Transcripts for your own review | Nowhere | Wherever your `onTranscript` hook puts them |

The two moves are independent: you can keep conversations in Postgres and knowledge in a vector store, or the other way round.

## When to move, and when not to

Move when one of these applies:

- **Zero Data Retention.** OpenAI's Conversations API isn't eligible for ZDR, so a ZDR organisation can't use the default. With your own store, turns are stateless (`store: false`).
- **Data residency.** Conversations and knowledge sit in a database in the region you choose ([What stays at OpenAI](#what-stays-at-openai)).
- **Retention and erasure.** OpenAI's API can't list conversations, so nothing can find or delete old ones. Your own store can sweep conversations idle for longer than your retention period.
- **Long conversations.** Only a store of your own can [compact](#6-compact-long-conversations) them.
- **Knowledge without per-search fees,** searched the same way on every model path.

Stay on the defaults when:

- you don't want to run, back up and migrate a database: the defaults need only an API key and a secret;
- your knowledge base is mostly PDFs, Word or PowerPoint files: your own index reads Markdown, MDX, plain text and HTML only, for now ([Knowledge base](knowledge-base.md#sync));
- you only need resume on one server or one Heroku dyno: the in-memory default does that already.

## What you need

- **Postgres,** tested on version 17. Conversations need nothing else.
- **pgvector,** only for the knowledge index. Neon, Supabase, Heroku Postgres, Amazon RDS and Google Cloud SQL all offer it; it is a trusted extension, so the database owner can create it. Check that your plan includes it.
- **A region** that matches your data residency needs. The database holds every conversation.
- **For resume across instances:** an Upstash Redis database, the one you may already use for [shared rate limits](deployment.md#vercel).

To follow along on your machine, start Postgres with pgvector in Docker:

```bash
docker run -d --name askdare-postgres -p 127.0.0.1:5432:5432 -e POSTGRES_USER=askdare -e POSTGRES_PASSWORD=askdare -e POSTGRES_DB=askdare pgvector/pgvector:pg17
```

### Connection strings

The app, `migrate` and `kb sync` read `DATABASE_URL`. Many hosts give you two connection strings:

- a **pooled** one (PgBouncer or Supavisor in transaction mode, such as Neon's `-pooler` host or Supabase's port 6543), for many short-lived serverless functions: use it for the app;
- a **direct** one: use it for `migrate` and `kb sync`, which hold a session lock while they work, and a transaction pooler can't keep that lock on one connection.

A host with only one connection string, or a local database, needs no distinction.

## 1. Install and migrate

```bash
npm install @boldare/askdare-postgres
```

Add the database to `.env.local`:

```bash
DATABASE_URL=postgres://askdare:askdare@127.0.0.1:5432/askdare
```

Create the tables:

```bash
npx askdare-postgres migrate
```

It reads `DATABASE_URL` from the environment, else from `.env.local`, then `.env`, and prints what it applied. askdare never changes the schema while it serves requests, so run `migrate` again before every deployment that brings a new version of the add-on ([Deploy](#9-deploy)). A database without pgvector migrates only the conversations: `npx askdare-postgres migrate conversations`.

The user that migrates owns the tables. The app's own user only needs `select`, `insert`, `update` and `delete` on them. More in the [add-on's README](../packages/askdare-postgres/README.md#migrate).

## 2. Keep conversations in Postgres

Pass the store to `createChatHandler`:

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { postgresConversations } from '@boldare/askdare-postgres';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  conversations: postgresConversations(), // DATABASE_URL; or { url } or { pool }
});
```

That is the whole change. From now on:

- each turn reads the conversation from Postgres, sends it to OpenAI with `store: false`, and appends what the model wrote: the visitor's message before the first model call, then each model call with its tool results in one transaction;
- the chat's history, paging, "Start a new conversation" and answer ratings work as before;
- the store connects on first use, so `next build` doesn't need the database.

**Existing conversations stay at OpenAI.** askdare doesn't copy them: a visitor who returns with a handle to an OpenAI conversation finds no conversation in Postgres, and the chat starts a new one. The old ones stay in your OpenAI project until deleted, as before ([Privacy](privacy.md#conversations)). Switching back to `openaiConversations()` later works the same way round.

How the store works, what it keeps and how to write your own: [Custom stores](custom-store.md#conversation-store) and the [add-on's README](../packages/askdare-postgres/README.md#conversations).

## 3. Move the knowledge base to pgvector

Skip this step if the bot has no knowledge base, or if it stays in a vector store.

Choose an OpenAI embedding model and a vector size, and put them in `.env.local` next to `DATABASE_URL`:

```bash
ASKDARE_EMBEDDING_MODEL=<an OpenAI embedding model>
ASKDARE_EMBEDDING_DIMENSIONS=1536
```

The library names no models. `kb sync` and the bot must use the same model and size; reading both from these two variables keeps them in step.

**Sync the folder** you already have, with its front matter and `askdare.kb.json` ([Knowledge base](knowledge-base.md#1-prepare-a-folder)), to an index named after the bot:

```bash
npx @boldare/askdare kb sync knowledge --index support
```

It reads `OPENAI_API_KEY`, `DATABASE_URL` and the two variables above, embeds every chunk, and reports what it added. Run it again whenever the documents change: it embeds only the chunks that changed. Run the first sync of an index as the user that migrated, since it creates the index's vector index ([Command line](cli.md#to-your-own-index)). `--dry-run` shows the documents and chunks without a key or a database.

**Connect the bot** to the index:

```ts
// askdare.config.ts
import { defineBot, openaiEmbedder } from '@boldare/askdare';
import { pgvectorIndex } from '@boldare/askdare-postgres';

const embedder = openaiEmbedder({
  model: process.env.ASKDARE_EMBEDDING_MODEL ?? '',
  dimensions: Number(process.env.ASKDARE_EMBEDDING_DIMENSIONS),
});

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: 'Answer questions about our products only from the documents you can search, and cite them.',
    // Reads DATABASE_URL; the index ID is the one you sync with.
    knowledge: { index: pgvectorIndex({ embedder, indexId: 'support' }) },
    // …
  }),
];
```

A bot has `vectorStoreId` or `index`, not both. The model now searches with the built-in `search_knowledge` tool, and visitors see the same numbered sources as with file search. `openaiEmbedder` throws when the model or size is missing, so set both variables wherever the app builds or runs, as you do `ASKDARE_MODEL`.

Once the bot answers from the index, delete the old vector store in the OpenAI dashboard and remove `KB_VECTOR_STORE_ID`. How search, citations and history work: [Knowledge base](knowledge-base.md#your-own-index) and the [add-on's README](../packages/askdare-postgres/README.md#knowledge-index).

## 4. Check it

Start the app and ask the bot something from your documents. The answer should cite them as `[1]`, with the source's title and link. Then, in a second terminal:

```bash
npx @boldare/askdare doctor
```

Next to the usual checks, each bot now lists the store's and the index's own:

```text
Bot "support"
  ✓ Model <model> is available.
  ✓ The key can create responses with <model>.
  ✓ Knowledge database: The database answers.
  ✓ pgvector: pgvector 0.8.7
  ✓ Knowledge schema: Schema version 1.
  ✓ Knowledge index: 2 documents, 3 chunks
  ✓ Knowledge embedder: openai:<embedding model>:1536
  ✓ Postgres conversation store: schema version 1.
```

A schema that is behind fails with "Run `npx askdare-postgres migrate`"; an index synced with another embedder, or not at all, fails with the `kb sync` command to run. With your own store, `doctor` no longer creates a test conversation at OpenAI: nothing of yours uses the Conversations API.

## 5. Resume answers across instances

When a visitor's connection drops mid-answer, the chat resumes it from the turn log ([Configuration](configuration.md#resume)). The default log lives in each instance's memory, which is enough for one server or one dyno. On Vercel, or with several dynos, share it through Upstash:

```bash
npm install @boldare/askdare-upstash @upstash/redis
```

```ts
// app/api/chat/[...path]/route.ts
import { upstashStore, upstashTurnLog } from '@boldare/askdare-upstash';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  conversations: postgresConversations(),
  limits: { store: upstashStore() },
  resume: { log: upstashTurnLog() },
});
```

Both read `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` names the Vercel Marketplace sets). The log holds the answer's text for a few minutes, then it expires ([Privacy](privacy.md#turn-log)). Resume needs the turn to keep running after its response closed: checked on `next start` (Heroku) and on a Vercel deployment ([Deployment](deployment.md#resuming-answers)). More in the [Upstash add-on's README](../packages/askdare-upstash/README.md#resuming-answers-across-instances).

## 6. Compact long conversations

Your own store replays the whole conversation on every model call. Most of it is read from the prompt cache, but it still grows the bill and the budgets turn by turn. `limits.compactAt` has OpenAI summarize a conversation after the turn that reaches that many input tokens, and the next turns replay from the summary:

```ts
defineBot({
  id: 'support',
  // …
  limits: { compactAt: 40_000 },
});
```

It runs in the background after the answer, so nobody waits for it, and it only works with a store that keeps the items, as `postgresConversations()` does. The summary is encrypted and opaque: only OpenAI can read it. What it saves and what it costs: [Configuration](configuration.md#compaction) and [Costs](costs.md#long-conversations-and-compaction).

## 7. Keep your own transcripts

askdare stores nothing for review. To keep what visitors asked and what they saw, for support, analysis or an admin view of your own, set `onTranscript`. It runs after each finished answer, never delays it, and receives the message after your `onInput` hook and the answer after your output checks ([Configuration](configuration.md#ontranscript)).

A table in the same database, with your own name (the add-on uses the `askdare_` prefix):

```sql
create table chat_transcripts (
  id bigint generated always as identity primary key,
  bot text not null,
  visitor text not null,
  conversation_id text not null,
  created_at timestamptz not null default now(),
  input text not null,
  answer text
);
create index on chat_transcripts (conversation_id);
create index on chat_transcripts (created_at);
```

One pool for the app, passed to the store and the index too, so each instance keeps one set of connections:

```bash
npm install pg
npm install -D @types/pg
```

```ts
// lib/db.ts
import pg from 'pg';

export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Without a listener, an idle connection that drops (a restart, a proxy timeout) crashes the process.
db.on('error', (error) => console.error(`Postgres pool: ${error.name}`));
```

```ts
// app/api/chat/[...path]/route.ts
import { db } from '../../../../lib/db';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  conversations: postgresConversations({ pool: db }),
  onTranscript: async ({ bot, visitor, conversationId, input, answer }) => {
    await db.query(
      'insert into chat_transcripts (bot, visitor, conversation_id, input, answer) values ($1, $2, $3, $4, $5)',
      [bot, visitor, conversationId, input, answer ?? null],
    );
  },
});
```

In `askdare.config.ts`, pass the same pool to the index: `pgvectorIndex({ embedder, indexId: 'support', pool: db })`.

A transcript is personal data, as the conversation is. askdare calls no hook when a conversation is deleted, by the visitor or by a sweep, so give transcripts a retention of their own: the [next step](#8-sweep-old-conversations) deletes both.

## 8. Sweep old conversations

Choose how long you keep a conversation after its last message, and delete older ones on a schedule. `sweep(idleSince, limit)` deletes up to `limit` conversations idle since `idleSince` and returns them with the files their visitors attached. askdare can't schedule work, so a cron route or a scheduled job calls it.

On Vercel, a cron route that Vercel calls with the `CRON_SECRET` you set in the project:

```ts
// app/api/cron/sweep/route.ts
import { postgresConversations } from '@boldare/askdare-postgres';
import OpenAI from 'openai';
import { db } from '../../../../lib/db';

const RETENTION_DAYS = 30;
const BATCH = 100;
const conversations = postgresConversations({ pool: db });
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
  // Transcripts by age, so those of conversations the visitor deleted go too. (Conversations go by
  // idle time: a conversation still in use keeps its turns, but its older transcripts go.)
  await db.query('delete from chat_transcripts where created_at < $1', [new Date(idleSince)]);
  return Response.json({ swept });
}
```

```json
{ "crons": [{ "path": "/api/cron/sweep", "schedule": "0 3 * * *" }] }
```

That goes in `vercel.json`. Add `openai` to your dependencies for the file deletion, leave the route out of your `proxy.ts` matcher, and if you skipped step 7, drop the transcript line and use `postgresConversations()` without `db`. On Heroku, run the same loop from a script with [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler); the [add-on's README](../packages/askdare-postgres/README.md#retention) has one.

To try it locally, set `RETENTION_DAYS` to `0` for one run, start the app with `CRON_SECRET` in `.env.local`, and call the route:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sweep
```

It answers `{"swept":1}` for one conversation, and the chat shows a new, empty conversation at its next reload. Set `RETENTION_DAYS` back before you deploy.

What the sweep covers, and what it doesn't:

- **Idle time** counts from the database's clock, at each message. A turn in progress is never swept.
- **Attachments** expire at OpenAI 30 days after upload anyway; with a retention of 30 days or more they are already gone. With a shorter one, delete them as above.
- **Compaction summaries** are part of the conversation and go with it.
- **Anything else you keep,** such as ratings from `onFeedback`, needs its own retention, by conversation ID or by age.
- **Conversations from before the move** stay at OpenAI: the sweep only sees your database.

## 9. Deploy

Add the new variables to every environment, next to [the usual ones](deployment.md#what-every-deployment-needs):

| Variable | Where | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Run time, and the build when it runs `migrate` | The pooled connection string, if your host has one. |
| `ASKDARE_EMBEDDING_MODEL`, `ASKDARE_EMBEDDING_DIMENSIONS` | Build and run time | Only with an own index. The same as for `kb sync`. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Run time | Only for shared limits and resume. |
| `CRON_SECRET` | Run time | Only for the Vercel cron route. |

**Migrate before the new code serves requests.**

- **Vercel:** in the build command, `askdare-postgres migrate && next build`. With a pooled `DATABASE_URL`, point `migrate` at the direct one, such as `DATABASE_URL=$DATABASE_URL_UNPOOLED askdare-postgres migrate && next build` with Neon's integration. Preview builds migrate the database their own variables point to.
- **Heroku:** in the `Procfile`, `release: npx askdare-postgres migrate`.

**Sync the knowledge** from your machine or from CI, with the production `DATABASE_URL` (the direct one) and the same embedding variables, whenever the documents change: `npx @boldare/askdare kb sync knowledge --index support --env-file .env.production.local`. Each environment's database has its own index.

Then check the live app with [`doctor --url`](cli.md#a-deployed-app).

## What stays at OpenAI

With both moves, OpenAI still processes every model request, and keeps less:

| Request | What OpenAI keeps | ZDR |
| --- | --- | --- |
| Turns and compactions (`/v1/responses` with `store: false`) | No conversation and no response. Abuse-monitoring logs of the requests for up to 30 days, unless your organisation is approved for ZDR or Modified Abuse Monitoring | Eligible |
| Embeddings, at `kb sync` and for each search query (`/v1/embeddings`) | Abuse-monitoring logs, as above. The index lives in your database | Eligible |
| Dictations (`/v1/audio/transcriptions`) | Nothing | Eligible |
| Moderation (`/v1/moderations`), with `moderation` | Nothing | Eligible |
| Attachments (`/v1/files`), for bots with `attachments` | The files, until they expire after 30 days or the conversation is deleted | Not eligible |
| `doctor` runs, for bots with `attachments` | One test file per bot, deleted at once | Not eligible |

From OpenAI's [data controls](https://developers.openai.com/api/docs/guides/your-data), checked on 2026-11-25; check them again before you rely on them. The same page names two more retentions, also under ZDR: the prompt cache keeps encrypted state on OpenAI's machines for up to 24 hours, and image and file inputs that its classifier flags as child sexual abuse material are kept for review.

- **Zero Data Retention.** OpenAI grants it per organisation or project after approval. With your own store and index, a ZDR project can run the bot, with one exception: attachments are stored as files. Leave `attachments` off if they must not be; `doctor` then uploads no test file either.
- **Data residency.** Conversations, knowledge and transcripts sit in your database, in its region, and the turn log in your Upstash database's region. Model requests go to OpenAI's global endpoint unless you set `OPENAI_BASE_URL` to a regional one, such as `https://eu.api.openai.com/v1`, with a key from a project in that region. OpenAI's EU endpoint stores and processes every request askdare makes with your own store (responses, embeddings, files, transcription, moderation); only the default Conversations API isn't on its list, which this guide replaces. Not yet run against a live EU project (2026-11-26). See [Regional OpenAI endpoints](deployment.md#regional-openai-endpoints) and [Compliance](compliance.md#3-data-residency).
- **Your privacy notice** now names your database host as a processor, the retention you chose, and transcripts if you keep them. [Privacy](privacy.md#with-your-own-conversation-store) has the details and a checklist.

## Costs and latency

Measured in askdare's spikes and checks, on 2026-11 models:

| | Default | Own data |
| --- | --- | --- |
| A 20-turn conversation (spike S7) | 0.0138 USD | 0.0135 USD: the replay is 96.9 % cached input |
| Time per turn (S7) | | About 1 s faster to finish; store reads and writes add about 40 ms per turn |
| Request size at turn 20 (S7) | Small: OpenAI reads its own copy | 32 KB, 22 KB of it the model's encrypted reasoning |
| An answer from the knowledge base, small model (spike S8) | 0.00276 USD, 90 % of it the file search fee | 0.00013 USD: no per-search fee, and smaller chunks |
| Answering with a search (S8) | | 1.4–1.9 times faster than `file_search`; a median 4.2 s end to end on the shipped code, with about 160 ms for the search itself |
| A 50-turn conversation, `gpt-6-luna` (spike S9) | Not compacted | 0.071 USD, or 0.031 USD with `compactAt: 20_000` |

- **Searching takes two model calls** when the model searches: one writes the query, the next answers.
- **Embedding** a 1,000-page site costs about 0.016 USD; later syncs embed only changed chunks. The index takes about 6 KB per chunk at 1,536 dimensions.
- **Postgres and Upstash** are billed by their hosts. Resume costs a few Upstash writes per answer, and about seven reads a second while a visitor resumes one.
- askdare's budgets count tokens the same way on every store ([Costs](costs.md)).

These are small conversations on few documents; measure your own with [`onUsage`](configuration.md#onusage) after the move.
