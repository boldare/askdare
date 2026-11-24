# @boldare/askdare-postgres

Keep [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare)'s data in your own Postgres.

**[askdare website and docs](https://askdare.vercel.app)** · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-postgres)

> **Work in progress.** This release only sets up the schema machinery. The conversation store and the pgvector knowledge index arrive in the next releases of askdare 0.6.

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

The database user that migrates needs the right to create tables. The app's own user then only needs to read and write them.

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
