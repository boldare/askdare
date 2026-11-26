# @boldare/askdare-upstash

Shared rate limits, token budgets and answer resume for [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare), stored in [Upstash Redis](https://upstash.com/).

**[askdare website and docs](https://askdare.vercel.app)** · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-upstash)

askdare counts limits in each instance's memory by default. That is enough for one server or one Heroku dyno. On Vercel, or with several dynos, every instance would count on its own, so a visitor could get several times the limit. This add-on keeps the counters in one Redis database that all instances share.

## Install

```bash
npm install @boldare/askdare-upstash @upstash/redis
```

## Use

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { upstashStore } from '@boldare/askdare-upstash';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: upstashStore() },
});
```

Set the database's REST URL and token in the environment:

| Variable | Notes |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | From the Upstash console. |
| `UPSTASH_REDIS_REST_TOKEN` | Use a token that can write. |

A database created through the Vercel Marketplace sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` instead. The add-on reads those too when the `UPSTASH_*` variables are missing.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `url`, `token` | the variables above | Connect without environment variables. |
| `redis` | a client made from `url` and `token` | Pass an existing `@upstash/redis` client. |
| `prefix` | `askdare:` | Prepended to every key, so several apps can share one database. |

Counters expire with their window, so the database needs no cleanup. Check the setup with `npx @boldare/askdare doctor`: it no longer warns about limits kept in memory.

For bots with guardrails that check answers, the same database also holds each conversation's one-turn-at-a-time hold, which expires on its own.

To make sure production never runs on per-instance counters by mistake, add `requireSharedStore`: the route then refuses to load unless the store is shared.

```ts
limits: {
  store: upstashStore(),
  requireSharedStore: process.env.NODE_ENV === 'production',
},
```

## Resuming answers across instances

When a visitor's connection drops in the middle of an answer, askdare can resume it from where it stopped, as long as the server that picks up the reconnect can read the answer's events. By default they stay in the memory of the instance that wrote them, so on Vercel or with several dynos a reconnect often lands where they aren't, and the visitor reloads the history instead. `upstashTurnLog()` keeps them in the same database as the rate limits, so any instance can resume:

```ts
import { upstashStore, upstashTurnLog } from '@boldare/askdare-upstash';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: upstashStore() },
  resume: { log: upstashTurnLog() },
});
```

You don't need it on a single server or a single dyno: the in-memory default resumes there.

Each answer is a Redis stream under `<prefix>turn:<id>`, written in batches of events (a few writes per answer, not one per word). **The stream holds the answer's text.** It expires a few minutes after the answer's last event, with the time to live askdare gives it, and the add-on logs nothing about what it holds. Mention the database in your privacy notice as you would any store of chat content.

Upstash's REST API can't block until a stream grows, so a reader that waits for the rest of an answer checks every 150 ms: about 7 commands a second for each visitor resuming a running answer, and none otherwise. `pollMs` changes the interval; longer saves commands, shorter shows the resumed text sooner.

| Option | Default | What it does |
| --- | --- | --- |
| `url`, `token`, `redis`, `prefix` | as for `upstashStore` | The same connection options. |
| `pollMs` | `150` | How often a waiting reader checks for new events, in ms. |

## Admin records

`upstashAdminStore()` keeps the admin console's records (ADR-0032) in the same database, for sites with no SQL database: usage per turn, ratings, transcripts when they are on, and daily counts of handoffs and leads (counts only, never their values). The `admin` option of `createChatHandler` writes them, deletes them with their conversation and sweeps them.

```ts
import { upstashAdminStore } from '@boldare/askdare-upstash';

createChatHandler({
  bots,
  admin: { store: upstashAdminStore({ retentionDays: 30 }), retentionDays: 30 },
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `url`, `token`, `redis`, `prefix` | as above | Keys go under `<prefix>admin:`. |
| `retentionDays` | `30` | A conversation's records also expire this many days after its latest record. Use the same value as `admin.retentionDays`. |

Every dashboard query is answered from counters, sorted sets and summaries kept when a record is written, so no read scans the database; each write and read is one atomic script. Key names hold a hash of the conversation ID, never the ID, a visitor or any content.

Retention is the handlers' `sweep()`, called on a schedule: it deletes records older than `admin.retentionDays`, and daily totals older than 400 days. The expiry times are a backstop for when it doesn't run: a conversation's keys expire `retentionDays` after its latest record, and daily totals 400 days after their day. Conversations with equal tokens and equal latest activity are ordered by the hash of their ID.

## Requirements

`@boldare/askdare` in the range of its peer dependency (each askdare release brings a matching add-on release), `@upstash/redis` 1.35 or later, and Node.js 22 or later.

## License

MIT © Boldare
