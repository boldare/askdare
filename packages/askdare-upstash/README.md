# @boldare/askdare-upstash

Shared rate limits and token budgets for [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare), stored in [Upstash Redis](https://upstash.com/).

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

## Requirements

`@boldare/askdare` of the same minor version, `@upstash/redis` 1.35 or later, and Node.js 22 or later.

## License

MIT © Boldare
