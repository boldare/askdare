# @boldare/askdare-postgres

Keep [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare)'s data in your own Postgres.

**[askdare website and docs](https://askdare.vercel.app)** · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-postgres)

> **Work in progress.** This release has the schema machinery and the pgvector knowledge index. The conversation store arrives in a later release of askdare 0.6, and `@boldare/askdare` exports the knowledge port that bots use the index through.

## Install

```bash
npm install @boldare/askdare-postgres
```

`pg` comes with it. Any hosted or own Postgres works, such as Neon, Supabase or Heroku Postgres; askdare is tested on Postgres 17. The knowledge index also needs the [pgvector](https://github.com/pgvector/pgvector) extension, which those hosts offer.

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

The schema has parts that upgrade independently: `knowledge` for the knowledge index, and the conversation store's. `migrate` creates every part. A database without pgvector can't hold the `knowledge` part, so name the parts you use:

```bash
npx askdare-postgres migrate conversations
```

```ts
await migrate({ parts: ['conversations'] });
```

`migrate` is idempotent: when the schema is up to date it changes nothing. Concurrent runs wait for each other. Each step runs in a transaction, so a failed one leaves the previous version in place. A database that a newer version of this package migrated makes it stop before changing anything.

The database user that migrates needs the right to create tables, and for the `knowledge` part the right to create the `vector` extension (pgvector is a trusted extension, so a database owner may). The app's own user then only needs to read and write them.

## Knowledge index

`pgvectorIndex` keeps a bot's knowledge in your database: documents, chunks and their embeddings. You choose the embedder, so you choose the key, the model and the vector size:

```ts
import { openaiEmbedder } from '@boldare/askdare'; // exported from the next 0.6 release
import { pgvectorIndex } from '@boldare/askdare-postgres';

export const knowledge = pgvectorIndex({
  embedder: openaiEmbedder({ model: '<embedding model>', dimensions: 1536 }),
  indexId: 'support', // default `default`
}); // DATABASE_URL; or { url } or { pool }
```

| Option | Default | What it does |
| --- | --- | --- |
| `embedder` | (required) | Turns chunks and questions into vectors. Its ID (provider, model and size) is stored with the index. |
| `indexId` | `default` | Which index this is. One database holds many bots' indexes, each under its own ID: letters, digits, `.`, `_`, `:` and `-`, at most 128 characters. Give every bot its own, such as the bot's ID: two bots on one ID share their documents. |
| `url`, `pool` | `DATABASE_URL` | As for `migrate`. One pool per connection string is shared with the conversation store. |

**Syncing.** `askdare kb sync` fills the index from your knowledge folder; the library never reads files at runtime. A sync is incremental: an unchanged file is skipped, a changed file re-embeds only its changed chunks, and a renamed file re-embeds nothing. Each document is written in one transaction, so a search never sees half a document. Syncs of one index wait for each other. A different embedder (another model or size) makes the next sync embed everything again; until it has run, searches fail and `diagnose()` says to sync.

The first sync of an index creates the index's HNSW index (one per index, for its vector size), so it needs the user that owns the tables, the one that migrates. Later syncs only read and write rows.

**Searching.** Search is hybrid, as ADR-0025 decided: the nearest chunks by cosine distance and the best full-text matches (Postgres' language-neutral `simple` configuration) are fused by reciprocal rank, with the full text weighted 0.3. Full text catches exact terms such as header and product names that embeddings blur. Results come in the fused order, each with its score and its source ID (`k` and 12 hex characters of the chunk's hash), which stays the same across syncs and turns. `passage(sourceId)` resolves a cited ID with one indexed lookup.

Vectors of up to 2,000 dimensions are indexed as `vector`, up to 4,000 as `halfvec`. Larger ones are searched exactly, without an index.

**Diagnosing.** `diagnose()` reports `knowledge.reachable` (the database answers), `knowledge.pgvector` (the extension and its version), `knowledge.schema` (run `migrate` when it is behind), `knowledge.synced` (document and chunk counts) and `knowledge.embedder` (the index was built with the bot's embedder). It reports counts and versions, never document text.

**Size.** About 6 KB per chunk at 1,536 dimensions: 10,000 chunks take about 60 MB.

## Connection options

| Option | Default | What it does |
| --- | --- | --- |
| `url` | `process.env.DATABASE_URL` | A connection string, such as `postgres://host:5432/db?sslmode=require`; the user and password go in the URL or in `PGUSER` and `PGPASSWORD`. |
| `pool` | a pool made from `url` | An existing `pg` `Pool`, or one with the same methods. askdare never ends a pool you pass. |

Tables are created without a schema name, so the connection's `search_path` decides where they go. Every table name starts with `askdare_`: the knowledge index uses `askdare_knowledge_indexes`, `askdare_knowledge_documents` and `askdare_knowledge_chunks`.

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
