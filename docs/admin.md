# Admin console and dashboard

askdare can keep a record of how your bots are used and show it to you in a console served by the chat route: each bot's resolved configuration, `doctor`, a playground, the conversations, and, with `@boldare/askdare-admin`, a dashboard of cost, ratings, unanswered questions, leads and handoffs ([ADR-0016](adr/0016-admin.md), [ADR-0032](adr/0032-admin-store.md)). Everything is off until you turn it on, and it needs no route, sign-in or database table of its own besides the store.

| Part | What it is | Needs |
| --- | --- | --- |
| The admin store | Where askdare writes each turn's counters, ratings and, if you choose, transcripts | `admin.store`: `postgresAdminStore()`, `upstashAdminStore()`, or `memoryAdminStore()` for development |
| The console | A page at `<basePath>/admin`: bots, doctor, playground, conversations | `admin.console`, and `ADMIN_SECRET` or a list of allowed users |
| The dashboard | Charts and lists inside the console | `@boldare/askdare-admin`, and an admin store |

## 1. Choose an admin store

askdare writes the records itself, from the same reports your `onUsage`, `onFeedback` and `onTranscript` hooks get, after the response, so they never delay an answer. Your hooks keep working as before. Deleting a conversation deletes its records, and `sweep()` applies the retention ([step 5](#5-sweep-on-a-schedule)).

| Store | Package | Use it when |
| --- | --- | --- |
| `postgresAdminStore()` | `@boldare/askdare-postgres` | You have Postgres, or keep conversations there already ([Own your data](own-your-data.md)). Run `npx askdare-postgres migrate` first: the `admin` part creates the `askdare_admin_` tables |
| `upstashAdminStore()` | `@boldare/askdare-upstash` | You have no SQL database. The same Upstash database as your [shared limits](deployment.md#vercel) |
| `memoryAdminStore()` | `@boldare/askdare` | Development and tests. Every instance has its own and a restart forgets it; production warns |

Each reads its connection like the add-on's other stores: `DATABASE_URL`, or `{ url }` or `{ pool }`, for Postgres; `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `{ url, token }` or `{ redis }`, for Upstash. See the [Postgres](https://github.com/boldare/askdare/tree/main/packages/askdare-postgres#admin-store) and [Upstash](https://github.com/boldare/askdare/tree/main/packages/askdare-upstash#admin-records) READMEs for their options.

## 2. Turn on the console

A route file may export only HTTP methods, and the sweep in step 5 needs the handlers too, so create them in a module of their own:

```ts
// lib/chat.ts
import { createChatHandler } from '@boldare/askdare/next';
import { postgresAdminStore, postgresConversations } from '@boldare/askdare-postgres';
import { bots } from '../askdare.config';

export const chat = createChatHandler({
  bots,
  conversations: postgresConversations(),
  admin: {
    store: postgresAdminStore(),
    console: {},
  },
});
```

```ts
// app/api/chat/[...path]/route.ts
import { chat } from '../../../../lib/chat';

export const maxDuration = 300;
export const { GET, POST, DELETE } = chat;
```

Generate an admin secret, at least 32 random characters, different from `CHAT_SECRET` and `IDENTITY_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

```bash
# .env.local
ADMIN_SECRET=…
```

Run the app, open `http://localhost:3000/api/chat/admin`, type the secret and press **Sign in**.

- **Without `admin.console`,** every `<basePath>/admin…` path answers `404` like any unknown path. Without `admin` at all, nothing is recorded.
- **Without `ADMIN_SECRET` and without `allow`,** the console answers an error, and in development the server log says which is missing. The secret is read on the first request, so `next build` doesn't need it.
- **Keep the console out of your `proxy.ts` matcher,** like the rest of the chat route. It sets its own headers.

The conversation store is the one the chat uses: the default (OpenAI's Conversations API) works too, but only your own store can be [swept](#5-sweep-on-a-schedule).

## 3. Sign in

There are two ways in. Use one or both.

**The secret.** Whoever knows `ADMIN_SECRET` signs in by typing it. It is a separate secret because it is typed into a browser, while `CHAT_SECRET` mints every token. The page keeps it in memory only. To end every session, change the secret: sessions signed with the old one stop at their next request.

**Your own sign-in.** List the users who may sign in, by the ID your app knows them by, and let an admin page of yours, behind your own sign-in, send them to the console with a short-lived identity token:

```ts
// lib/chat.ts
admin: {
  store: postgresAdminStore(),
  console: { allow: ['user_123', 'user_456'] },
},
```

```tsx
// app/(internal)/admin/page.tsx: behind your app's own sign-in
import { SignJWT } from 'jose';
import { requireStaff } from '@/lib/auth'; // your own check

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await requireStaff();
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id) // must be in admin.console.allow
    .setAudience('askdare:admin')
    .setIssuedAt()
    .setExpirationTime('5m') // at most 10 minutes
    .sign(new TextEncoder().encode(process.env.IDENTITY_SECRET));
  return <a href={`/api/chat/admin#identity=${token}`}>Open the askdare console</a>;
}
```

- The token is signed with `IDENTITY_SECRET`, as for [signed-in visitors](identity.md), with the audience `askdare:admin`, which no bot ID can have, so no visitor's token opens the console. `allow` needs `IDENTITY_SECRET`; without it, only `ADMIN_SECRET` signs in, and the server log says so once.
- The token travels in the URL's fragment, which reaches neither the server, nor its logs, nor a `Referer`, and the console removes it from the address bar at once.
- Removing a user from `allow` ends their sessions at their next request.

Either way, the console then holds a session token for 15 minutes, in memory, sent with every request. It sets no cookies and stores nothing: a reload signs in again. Sign-ins are limited to 5 a minute per IP address and 20 an hour across the app, and the kill switch (`ASKDARE_DISABLED`) refuses them too. askdare checks every request itself, whatever your own sign-in did.

## What the console shows

| View | What it shows |
| --- | --- |
| **Bots** | Each bot's resolved configuration: the model, the instructions as the model gets them, tool names, knowledge, limits, guardrails, origins, widget settings and texts per language. Built from a fixed list of fields: secrets, keys, hooks and environment values never appear |
| **Doctor** | The same checks as `npx @boldare/askdare doctor` |
| **Playground** | A chat with any bot, through the normal path with the bot's limits and budgets. Its turns reach your `onUsage` and are recorded as the console's, so the dashboard leaves them out. Its conversation is deleted when you leave the page, as far as the browser allows; retention removes the rest |
| **Conversations** | With an admin store: conversations by date or by tokens, or only those with a 👎. Open one to read it, from its stored transcript or, without one, from the conversation store |
| **Dashboard** | With `@boldare/askdare-admin` (next step) |

The browser never gets a conversation's ID: lists carry references sealed to your session, which stop working when it ends. Every text from a conversation is shown as text, never as HTML.

## 4. Add the dashboard

```bash
npm install @boldare/askdare-admin
```

```ts
// lib/chat.ts
import { adminDashboard } from '@boldare/askdare-admin';

export const chat = createChatHandler({
  bots,
  conversations: postgresConversations(),
  admin: {
    store: postgresAdminStore(),
    transcripts: true,
    retentionDays: 30,
    console: {
      allow: ['user_123'],
      dashboard: adminDashboard({
        // What you pay per million tokens, by model ID, in your currency.
        prices: { 'your-model-id': { input: 1.25, cachedInput: 0.125, output: 10 } },
      }),
    },
  },
});
```

The dashboard has no route, sign-in or storage of its own: the console serves it, checks access and passes it the store. Its **Dashboard** view shows, for the last 7, 30 or 90 days, for all bots or one:

- **Cost** per bot, day and model, from your `prices`. A model without a price shows its tokens and "no price". askdare keeps tokens, not money, and holds no price table: OpenAI changes prices, and you know what you pay.
- **Conversations, turns, 👍 and 👎** per day.
- **Unanswered questions:** completed answers without sources from bots with knowledge, plus withheld and failed ones. A heuristic, and the dashboard says so.
- **Leads and handoffs** per day, handoffs by outcome, and the **resolution rate**: the share of new conversations without a handoff, per day.
- **The most expensive conversations,** and **the 👎 answers with the visitors' comments.** Open one to review the conversation.

`dashboard` needs `admin.store`; the route doesn't load without it. Playground turns are left out.

## 5. Sweep on a schedule

Records are kept for `admin.retentionDays` (default 30, at most 400). Nothing deletes them until your app calls `sweep()`, which `createChatHandler` returns next to `GET`, `POST` and `DELETE`. In one call it deletes conversations idle for `idleDays` (with a store that can list them, not OpenAI's), with their files and admin records, then admin records older than `admin.retentionDays`, and daily totals older than 400 days.

```ts
// app/api/cron/sweep/route.ts
import { chat } from '../../../../lib/chat';

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  // { conversations, files, records, more }: with `more`, the next run continues.
  return Response.json(await chat.sweep({ idleDays: 30, signal: request.signal }));
}
```

```json
{ "crons": [{ "path": "/api/cron/sweep", "schedule": "0 3 * * *" }] }
```

That goes in `vercel.json`; on Heroku, call `chat.sweep()` from [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler). [Own your data](own-your-data.md#8-sweep-old-conversations) covers the sweep in full. `askdare doctor` warns when an admin store holds records older than `admin.retentionDays`, which means the sweep isn't running. The retention is set only there: askdare passes it to the store with every record it writes, and Upstash keys also expire on their own after it, as a backstop.

## What the admin store keeps

| Record | Holds | Written | Deleted |
| --- | --- | --- | --- |
| Turns | Bot, model, tokens, duration, outcome, step count, tool names and outcomes, number of sources, what output checks decided. No text | Every turn | With the conversation, or after `retentionDays` |
| Ratings | 👍 or 👎 per answer, and the comment the visitor wrote | When a visitor rates an answer | The same |
| Transcripts | The visitor's message after `onInput`, the number of files, the answer they saw after output checks, its sources | Only with `admin.transcripts: true` | The same |
| Daily totals | Per bot, day and model: turns, failures, unanswered, tokens; per bot and day: conversations, ratings, leads, handoffs by outcome. No conversation, visitor or text | Every turn, rating, lead and handoff | After 400 days; not when a conversation is deleted |

Every record but the daily totals carries the bot, the conversation's ID in your conversation store, the visitor's pseudonym (the HMAC `onUsage` reports, never a raw ID or IP address), the time and whether it came from the chat or the console.

- **Leads and handoffs are only counted,** per bot and day. The admin store keeps no form values, contact details or requests: those go to your [`onLead`](forms.md#what-onlead-receives) and [`onHandoff`](handoff.md#what-onhandoff-receives).
- **Ratings need no `onFeedback`** once there is an admin store: the 👍 and 👎 buttons show for bots that don't turn them off (`widget.feedback: false`), and each rating is recorded, with `onFeedback` called as well when you set it.
- **Transcripts are off by default.** Turn them on to review conversations in the dashboard; they are personal data, kept as long as the other records.
- **A failed write** never fails a turn: `onError` gets `internal_error` with the error's class name, and that record is lost. The stores never log what they write.

## Privacy

- **Where it lives:** your Postgres or Upstash database. Name its host in your privacy notice, as for [your own conversation store](privacy.md#with-your-own-conversation-store).
- **What is personal data:** ratings' comments and transcripts are what visitors wrote; pseudonyms and conversation IDs link records to a visitor. Daily totals hold none.
- **Erasure:** a visitor who starts a new conversation deletes it, and its records go with it, in the same request. A sweep does the same for idle conversations. To delete one person's records on request, find their conversations by pseudonym (`visitor`) and delete each through your conversation store's tools and `store.deleteConversation(conversationId)`.
- **Retention:** `retentionDays`, applied by your scheduled `sweep()`.
- **Who sees it:** whoever signs in to the console. Treat `ADMIN_SECRET` and the `allow` list like access to your database.

See [Privacy](privacy.md#admin-store) for the list to put in your notice.

## Security

- **Headers** on the console page and every answer: `Cache-Control: no-store`, a Content Security Policy that allows only the console's own scripts, styles and requests (`frame-ancestors 'none'`, so no site can frame it), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin` and `X-Robots-Tag: noindex`.
- **No cookies, no browser storage:** the session token lives in the page's memory for 15 minutes.
- **No raw conversation IDs** reach the browser, the owner's included.
- **Nothing for visitors:** the widget and the React chat never load the console's code, and apps without `admin.console` never evaluate it.

## Your own admin store

The `AdminStore` interface and its types are exported from `@boldare/askdare`, and `adminStoreContract` from `@boldare/askdare/testing` runs the suite every store must pass: fixed queries bounded by a day range and a limit of 100, daily totals kept when they are written, idempotent writes and deletes. Each record write gets `{ retentionDays, signal }` (`AdminWriteOptions`): a store that expires records on its own, as a backstop, must not expire one sooner, and keeps 400 days when it is absent. The retention warning in `askdare doctor` is core's; a store's `diagnose()` reports only its own state. Read `postgresAdminStore` in `@boldare/askdare-postgres` as an example.
