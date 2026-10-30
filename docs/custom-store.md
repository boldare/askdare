# Custom rate-limit store

Rate limits and budgets are counters, and the counters live in a store. The default store keeps them in the memory of each server process. That works for one instance. With more instances (Vercel, several Heroku dynos, autoscaling), each one counts on its own, so visitors get a multiple of every limit.

`@boldare/askdare-upstash` is the shared store that askdare ships. Write your own when you want the counters in a database you already run.

`RateLimitStore` and `CounterHit` are public API ([ADR-0006](adr/0006-support-matrix-and-versioning.md)). Import them as types from `@boldare/askdare`.

## The interface

```ts
interface RateLimitStore {
  hit(key: string, windowMs: number, amount: number): Promise<CounterHit>;
  readonly shared: boolean;
}

interface CounterHit {
  /** Counter value after the increment. */
  readonly count: number;
  /** Milliseconds until the window resets. */
  readonly resetMs: number;
}
```

## `hit(key, windowMs, amount)`

Each key is one counter with a fixed window. `hit` adds `amount` to the counter and returns the result.

| Situation | What `hit` does |
| --- | --- |
| No open window for `key` (a new key, or its window has ended) | Starts a new counter at `amount`, with a window that ends `windowMs` milliseconds from now. |
| An open window | Adds `amount`. The window keeps its end, whatever `windowMs` this call passes. |
| `amount` is `0` | Reads. Returns the count without changing it, `0` when no window is open. |
| `amount` is negative | Refunds: the count goes down by that much. Don't clamp it at zero. |

The result:

| Field | Meaning |
| --- | --- |
| `count` | The counter after this call's `amount` is added. askdare compares it with the limit. |
| `resetMs` | Milliseconds until the window ends: more than 0, and at most `windowMs` for a window that this call opened. askdare uses it for the `Retry-After` of a `rate_limited` answer, and waits at least one second. |

askdare uses refunds to give back a reservation. A turn reserves an estimate against each token budget. When the turn ends, askdare adds the difference between the real usage and the estimate, which is often negative. When a reservation would cross a budget, askdare refunds it from every budget it has already charged.

### Rules

- **Atomic per key.** Concurrent calls for the same key must all count, and each must see its own result. askdare reserves budgets with `hit` and checks the returned count, so a lost update lets concurrent turns overshoot a budget. Use one atomic operation, such as Redis `INCRBY` or an SQL upsert with `RETURNING`.
- **Keys are independent.** askdare never needs a change across several keys at once.
- **Whole numbers.** Amounts are always integers. Token budgets reach millions, so store counts as 64-bit integers.
- **Opaque keys.** Don't parse keys: their format is internal and may change. Some are longer than 100 characters. Some contain client IP addresses, so treat the store as personal data and keep keys out of your logs.
- **Windows** range from one minute to 30 days. You can delete a counter once its window has ended.
- **Fail loudly.** If `hit` throws or rejects, the request fails with `internal_error` (status 500), and `onError` receives it. Never catch an error and return a zero count: that turns every limit off. The default store does the same when it runs out of room: it drops expired and short-lived counters first, and refuses requests rather than forget what a budget has spent.
- **One round trip.** Each message calls `hit` several times, mostly one after another. Keep each call to one request to your database.

## The `shared` flag

`shared` says whether every server instance sees the same counters. It doesn't change how limits are enforced. It only changes two warnings:

- When `shared` is `false` and `NODE_ENV` is `production`, `createChatHandler` logs a warning as the route loads: `[askdare] Rate limits are kept in memory, per instance. With more than one instance, use a shared store such as @boldare/askdare-upstash.`
- `npx @boldare/askdare doctor` warns that rate limits and budgets are kept per instance, unless the app runs in development.

Set `shared: true` only when every instance reaches the same counters, such as a database they all connect to. A store that keeps counters inside the process is `shared: false`, even if you wrote it.

## Example: PostgreSQL

A sketch with the `pg` client. One table holds every counter:

```sql
CREATE TABLE askdare_counters (
  key      text        PRIMARY KEY,
  total    bigint      NOT NULL,
  reset_at timestamptz NOT NULL
);
```

One upsert per call opens, adds to or restarts a window. PostgreSQL locks the row for it, so concurrent calls for a key never lose an update:

```ts
// lib/postgres-store.ts
import type { CounterHit, RateLimitStore } from '@boldare/askdare';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const HIT = `
  INSERT INTO askdare_counters AS c (key, total, reset_at)
  VALUES ($1, $2, now() + make_interval(secs => $3::float8 / 1000))
  ON CONFLICT (key) DO UPDATE SET
    total    = CASE WHEN c.reset_at > now() THEN c.total + EXCLUDED.total ELSE EXCLUDED.total END,
    reset_at = CASE WHEN c.reset_at > now() THEN c.reset_at ELSE EXCLUDED.reset_at END
  RETURNING total, ceil(extract(epoch FROM reset_at - now()) * 1000) AS reset_ms`;

export function postgresStore(): RateLimitStore {
  return {
    shared: true,
    async hit(key, windowMs, amount): Promise<CounterHit> {
      const { rows } = await pool.query<{ total: string; reset_ms: string }>(HIT, [
        key,
        amount,
        windowMs,
      ]);
      const row = rows[0];
      if (!row) throw new Error('postgresStore: the counter upsert returned no row.');
      return { count: Number(row.total), resetMs: Number(row.reset_ms) };
    },
  };
}
```

Expired rows do no harm: the next `hit` restarts them. To keep the table small, delete them from a scheduled job:

```sql
DELETE FROM askdare_counters WHERE reset_at < now();
```

## Plug it in

Pass the store to `createChatHandler` as `limits.store`:

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '@/askdare.config';
import { postgresStore } from '@/lib/postgres-store';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: postgresStore() },
});
```

One store serves every bot of the handler. If several apps share one database, give each its own key prefix, as `upstashStore({ prefix })` does. [Configuration](configuration.md#handler-limits) lists the other `limits` options.

## Test it

The built-in stores share a contract test, but the package doesn't export it. Copy the cases into your own tests:

| Case | Expected |
| --- | --- |
| Adds within a window | `hit(k, 60_000, 1)` returns a count of 1, then `hit(k, 60_000, 5)` returns 6. |
| Reads with `0` | After `hit(k, 60_000, 2)`, two calls of `hit(k, 60_000, 0)` both return 2. |
| Keeps keys apart | After `hit(c, 60_000, 3)`, `hit(d, 60_000, 1)` returns 1. |
| Reports the time left | A new window's `resetMs` is more than 0 and at most `windowMs`. |
| Refunds | After `hit(k, 60_000, 3)`, `hit(k, 60_000, -1)` returns 2. |
| Restarts after the window | Once the window has passed, the next `hit` starts again from its `amount`. |
| Never loses an update | 50 parallel calls of `hit(k, 60_000, 1)` return each count from 1 to 50 exactly once. |

The first four are the contract that `@boldare/askdare-upstash` and the in-memory store pass. The rest are tested on the in-memory store and the limits that use it. With Vitest:

```ts
// lib/postgres-store.test.ts
import { randomUUID } from 'node:crypto';
import type { RateLimitStore } from '@boldare/askdare';
import { describe, expect, it } from 'vitest';
import { postgresStore } from './postgres-store';

function rateLimitStoreContract(name: string, create: () => RateLimitStore): void {
  describe(`${name} (RateLimitStore contract)`, () => {
    // A fresh prefix per run, so counters from earlier runs don't interfere.
    const run = randomUUID();
    const key = (id: string): string => `contract:${run}:${id}`;

    it('adds amounts within a window', async () => {
      const store = create();
      expect((await store.hit(key('a'), 60_000, 1)).count).toBe(1);
      expect((await store.hit(key('a'), 60_000, 5)).count).toBe(6);
    });

    it('reads without changing when the amount is 0', async () => {
      const store = create();
      await store.hit(key('b'), 60_000, 2);
      expect((await store.hit(key('b'), 60_000, 0)).count).toBe(2);
      expect((await store.hit(key('b'), 60_000, 0)).count).toBe(2);
    });

    it('keeps keys independent', async () => {
      const store = create();
      await store.hit(key('c'), 60_000, 3);
      expect((await store.hit(key('d'), 60_000, 1)).count).toBe(1);
    });

    it('reports the time left in the window', async () => {
      const store = create();
      const { resetMs } = await store.hit(key('e'), 60_000, 1);
      expect(resetMs).toBeGreaterThan(0);
      expect(resetMs).toBeLessThanOrEqual(60_000);
    });

    it('refunds negative amounts', async () => {
      const store = create();
      await store.hit(key('f'), 60_000, 3);
      expect((await store.hit(key('f'), 60_000, -1)).count).toBe(2);
    });

    it('starts a new window once the old one has passed', async () => {
      const store = create();
      await store.hit(key('g'), 1_000, 3);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect((await store.hit(key('g'), 1_000, 1)).count).toBe(1);
    });

    it('never loses a concurrent update', async () => {
      const store = create();
      const hits = await Promise.all(
        Array.from({ length: 50 }, () => store.hit(key('h'), 60_000, 1)),
      );
      expect(hits.map((hit) => hit.count).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 1),
      );
    });
  });
}

rateLimitStoreContract('postgresStore', () => postgresStore());

describe('postgresStore', () => {
  it('is shared across instances', () => {
    expect(postgresStore().shared).toBe(true);
  });
});
```

Run these tests against a real database. A mock can't show that concurrent updates are atomic.

## The reference implementation

`@boldare/askdare-upstash` stores the counters in Upstash Redis over HTTPS, so it works on Vercel and Heroku alike. Read it before you write your own.

```bash
npm install @boldare/askdare-upstash @upstash/redis
```

```ts
import { createChatHandler } from '@boldare/askdare/next';
import { upstashStore } from '@boldare/askdare-upstash';
import { bots } from '@/askdare.config';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: upstashStore() },
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `redis` | created from `url` and `token` | An existing `@upstash/redis` client. |
| `url` | `UPSTASH_REDIS_REST_URL`, else `KV_REST_API_URL` | The database's REST URL. |
| `token` | `UPSTASH_REDIS_REST_TOKEN`, else `KV_REST_API_TOKEN` | The database's REST token. |
| `prefix` | `'askdare:'` | Key prefix, to share one database between apps. |

How it meets the rules:

- Each `hit` runs one Lua script in one round trip. Redis runs a script atomically.
- The script adds `amount` with `INCRBY`, then reads the key's time to live with `PTTL`. Only a key without one gets `PEXPIRE` with `windowMs`. So an open window keeps its end, and a key that expired starts again.
- It returns the count and the time to live as `resetMs`.
- It reads the URL and token on first use, not at import, so `next build` doesn't need them. Without them, the first `hit` throws, and the request fails.
- `shared` is `true`.
