# ADR-0032: The admin console and the `AdminStore` port

- **Status:** Accepted on 2026-11-27 (task z1), as built by tasks p2, a1, a2, c5 and a3. Decisions 2, 7, 8 and 9 are amended below ("As built in 0.7").
- **Date:** 2026-11-26
- **Extends:** [ADR-0016](0016-admin.md), which stays accepted. This ADR fixes what building it needs: the `AdminStore` port, how a deleted or swept conversation reaches it, how the stage 1 console is served and signed into, and what `@boldare/askdare-admin` contains. Where it refines ADR-0016, it says so (decision 3).
- **Built by:** p2 (the port, the memory store, the contract suite), a1 and a2 (Postgres and Upstash stores), c5 (the console, delete and sweep), a3 (the dashboard). Accepted, or amended, by them.

## Context

ADR-0016 decided two stages: a console without a database, then an add-on with an `AdminStore` "shaped like `RateLimitStore`", fed by `onUsage`, `onFeedback` and `onTranscript`. 0.6 shipped `onTranscript` and the `ConversationStore` port ([ADR-0024](0024-conversation-store.md)), but left two gaps the ROADMAP lists:
- **Transcripts outlive a deleted conversation.** Neither `DELETE <basePath>/conversation` nor a store's `sweep` reaches anything but the conversation store. ADR-0016 ("As of 0.6") moved that duty to the `AdminStore`, so the port must exist in core, not only in an add-on.
- **No sweep helper in core.** A site's cron route deletes swept conversations' files with the `openai` SDK itself ([Own your data](../own-your-data.md#8-sweep-old-conversations)), so the app has to import `openai` and repeat what `DELETE /conversation` does.

The stage 1 console is also the first page askdare serves that isn't the widget, and the first that shows server configuration in a browser ([ADR-0008](0008-ui-customization-and-themes.md)). It must be served like the widget app, from memory ([ADR-0005](0005-embedding-model.md); the library reads no files at runtime), and must not cost the loader (5,016 of 5,120 bytes) or the React entry (near its 34 KB, [ADR-0028](0028-react-budget-34-kb.md)) a byte.

Handoffs ([ADR-0030](0030-handoff.md)) and forms with leads ([ADR-0031](0031-forms-and-leads.md)) were decided at the same time. ADR-0031 keeps askdare from storing form values, so the admin store counts handoffs and leads and keeps nothing else of them (decision 6).

## Decision

### 1. Where each part lives

| Package | What it gets |
|---|---|
| `@boldare/askdare` | The `AdminStore` port and its record and query types; `memoryAdminStore()`; `adminStoreContract` in `@boldare/askdare/testing`; the `admin` option of `createChatHandler` (the store, transcripts, retention, the console); writing records; delete and sweep reaching the store; `sweep()` on the handlers; the stage 1 console. |
| `@boldare/askdare-postgres` | `postgresAdminStore({ pool })`, its schema in the existing `migrate`, in the same pool as `postgresConversations`. |
| `@boldare/askdare-upstash` | `upstashAdminStore({ redis })`. |
| `@boldare/askdare-admin` (new) | `adminDashboard()`: the stage 2 dashboard UI and its read queries, plugged into the console (decision 9). No hooks, no storage, no `next` or `openai` dependency. |

The core stays database-free: the port is an interface, and the only implementation in core keeps records in memory, with the same production warning as `memoryStore()`.

### 2. The port

Names are final in p2. Every method takes an optional `signal`. Implementations never log the values they write; a failure is reported by error class and code only.

```ts
import type { ChatTokenUsage, ConversationStoreCheck, ErrorCode, MessageEndReason } from '@boldare/askdare';

/** Who and what a record belongs to. Every record has these, so delete and retention work alike. */
interface AdminRecordKey {
  readonly bot: string;
  /**
   * The conversation store's ID. Kept on the server: the console's browser gets sealed references
   * (decision 8), never this value.
   */
  readonly conversationId: string;
  /** The pseudonym `onUsage` reports (an HMAC of the user or visitor). Never a raw ID or an IP. */
  readonly visitor: string;
  /** Epoch milliseconds; retention counts from here. */
  readonly at: number;
  /** `console` for playground turns (decision 7), so the dashboard can leave them out. */
  readonly source: 'chat' | 'console';
}

/** One turn: counters only, never content. Written for every turn when a store is set. */
interface AdminTurnRecord extends AdminRecordKey {
  readonly model: string;
  readonly durationMs: number;
  readonly outcome: 'completed' | 'stopped' | 'failed';
  readonly finishReason?: MessageEndReason | undefined;
  readonly errorCode?: ErrorCode | undefined;
  /** The turn's usage plus its compaction's, if any. */
  readonly usage: ChatTokenUsage;
  readonly steps: number;
  /** Names and outcomes only, as `ChatToolCallReport` without timings. */
  readonly tools: readonly { readonly name: string; readonly outcome: 'ok' | 'error' | 'timeout' }[];
  /** Sources shown with the answer; 0 feeds "unanswered questions" (decision 5). */
  readonly citations: number;
  /** What output checks decided (ADR-0022), when the bot has them. */
  readonly check?: 'allowed' | 'replaced' | 'withheld' | undefined;
  /** The turn created the conversation; counted in `AdminBotDayRow.conversations`. */
  readonly newConversation: boolean;
}

/** One rating. A later rating of the same answer replaces it; `rating: null` removes it. */
interface AdminRatingRecord extends AdminRecordKey {
  readonly itemId: string;
  readonly rating: 'up' | 'down' | null;
  /** Up to 500 characters, the visitor's own words: personal data, never logged. */
  readonly comment?: string | undefined;
}

/** One turn's text: written only with `admin.transcripts: true` (decision 4). */
interface AdminTranscriptRecord extends AdminRecordKey {
  readonly itemId?: string | undefined;
  readonly input: string;
  readonly attachments: number;
  readonly answer: string | undefined;
  readonly citations: readonly { readonly index: number; readonly title: string; readonly url?: string | undefined }[];
  readonly check?: 'allowed' | 'replaced' | 'withheld' | undefined;
  readonly reason: MessageEndReason;
}

/**
 * A handoff or a lead, counted (decision 6). No conversation, visitor, reason, contact details or
 * form values: only what a daily counter needs.
 */
type AdminCountEvent =
  | {
      readonly kind: 'handoff';
      readonly bot: string;
      readonly at: number;
      readonly source: 'chat' | 'console';
      /** ADR-0030's final state; `requested` is never counted. */
      readonly state: 'sent' | 'saved' | 'unavailable' | 'failed' | 'limited';
    }
  | {
      readonly kind: 'lead';
      readonly bot: string;
      readonly at: number;
      readonly source: 'chat' | 'console';
    };

/** A day range in UTC, `from` and `to` as `YYYY-MM-DD`, both included, at most 400 days. */
interface AdminRange {
  readonly from: string;
  readonly to: string;
  readonly bot?: string | undefined;
  /** Default `chat`: playground turns are left out. */
  readonly source?: 'chat' | 'console' | 'all' | undefined;
}

/** Daily totals, kept as counters at write time so a key-value store can answer them. */
interface AdminDayRow {
  readonly day: string;
  readonly bot: string;
  readonly model: string;
  readonly turns: number;
  readonly failed: number;
  readonly unanswered: number;
  readonly usage: ChatTokenUsage;
}
/** Daily totals per bot, for what has no model: conversations, ratings, leads and handoffs. */
interface AdminBotDayRow {
  readonly day: string;
  readonly bot: string;
  readonly conversations: number;
  readonly up: number;
  readonly down: number;
  readonly leads: number;
  readonly handoffs: {
    readonly sent: number;
    readonly saved: number;
    readonly unavailable: number;
    readonly failed: number;
    readonly limited: number;
  };
}

/** One conversation in the dashboard's lists. */
interface AdminConversationSummary {
  readonly conversationId: string;
  readonly bot: string;
  readonly visitor: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly turns: number;
  readonly usage: ChatTokenUsage;
  readonly up: number;
  readonly down: number;
  readonly transcript: boolean;
}

interface AdminPage<T> {
  readonly items: readonly T[];
  /** Opaque; absent on the last page. */
  readonly cursor?: string | undefined;
}

export interface AdminStore {
  readonly name: string;

  // Writes, by core only (decision 3). Idempotent per (conversationId, at, itemId) where given.
  recordTurn(record: AdminTurnRecord, signal?: AbortSignal): Promise<void>;
  recordRating(record: AdminRatingRecord, signal?: AbortSignal): Promise<void>;
  recordTranscript(record: AdminTranscriptRecord, signal?: AbortSignal): Promise<void>;
  /** Increments a daily counter; nothing else is kept. */
  count(event: AdminCountEvent, signal?: AbortSignal): Promise<void>;

  // Reads, by the console and the dashboard. Fixed queries, bounded by a range and a limit.
  days(range: AdminRange, signal?: AbortSignal): Promise<{
    readonly turns: readonly AdminDayRow[];
    readonly bots: readonly AdminBotDayRow[];
  }>;
  conversations(
    query: AdminRange & {
      readonly order: 'tokens' | 'latest';
      readonly rated?: 'down' | undefined;
      readonly limit: number; // at most 100
      readonly cursor?: string | undefined;
    },
    signal?: AbortSignal,
  ): Promise<AdminPage<AdminConversationSummary>>;
  ratings(
    query: AdminRange & {
      readonly rating?: 'up' | 'down' | undefined;
      readonly limit: number; // at most 100
      readonly cursor?: string | undefined;
    },
    signal?: AbortSignal,
  ): Promise<AdminPage<AdminRatingRecord>>;
  /** Oldest first; empty without transcripts. */
  transcript(conversationId: string, signal?: AbortSignal): Promise<readonly AdminTranscriptRecord[]>;

  // Erasure and retention (decision 4).
  /** Deletes every record of the conversation. Unknown is not an error; calling it twice is fine. */
  deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void>;
  /**
   * Deletes up to `limit` records written before `recordsBefore`, and daily rows of days before
   * `daysBefore`. Resolves to how many it deleted, so the caller loops until it is under `limit`.
   */
  sweep(
    options: { readonly recordsBefore: number; readonly daysBefore: string; readonly limit: number },
    signal?: AbortSignal,
  ): Promise<number>;

  /** Schema status and the oldest record's age, for `askdare doctor` (decision 4). Check type shared or renamed in p2. */
  diagnose?(signal?: AbortSignal): Promise<readonly ConversationStoreCheck[]>;
}
```

Rules every implementation keeps, checked by `adminStoreContract` (same signature as the other suites: `(name, create, { describe, it, expect, …options })`, deleting everything it writes):
- **Queries are fixed,** not free-form. Each is bounded by a day range and a limit of at most 100, so Upstash can answer it from counters, sorted sets and lists maintained at write time. A store may not scan its whole data set to answer one.
- **Daily rows are aggregates with no conversation or visitor in them.** `deleteConversation` leaves them; costs over time stay right after an erasure. Only `sweep` removes them.
- **Everything else is deleted with its conversation:** turns, ratings, transcripts and conversation summaries. Counted handoffs and leads exist only in daily rows.
- **A rating with `rating: null`** removes the stored one and adjusts the counters; a repeated rating replaces, never adds.
- **Tokens, not money.** The store keeps token counts. Prices are the app's (`adminDashboard({ prices })`, decision 9): askdare holds no model IDs or price tables, and OpenAI changes both.

### 3. Who writes: core, from the reports the hooks get

`createChatHandler({ admin: { store } })` makes core write records itself, from the same values it hands `onUsage`, `onFeedback` and `onTranscript`, after the response and alongside those hooks, which stay the app's own.

This refines ADR-0016's "fed by server hooks": the data is the hooks' data, but the app doesn't wire hooks into the store. One option then covers writes, delete and sweep, so an app can't feed the store through hooks while forgetting to pass it to the handler, which would leave every delete short of the store. `@boldare/askdare-admin` therefore contains no hook wiring.

- A write that fails is reported like a failing hook: to `onError` as `internal_error` with the error's class name, never its message.
- Writes never delay or fail a turn. They run in the same `after()` work as the hooks.
- Handoffs are counted once ADR-0030's outcome is final, leads when an accepted form submission is handed to `onLead`.
- Ratings: `POST /feedback` is accepted for a bot with `widget.feedback` when either `onFeedback` or an admin store is set (today it needs `onFeedback`).

### 4. Delete, sweep and retention

**`DELETE <basePath>/conversation`.** Once ownership is checked (`info()`, as today), core calls, in this order:
1. `admin.store.deleteConversation(id)`;
2. `conversations.delete(id)`;
3. the gateway's `deleteFiles` for the files it returns.

The admin store goes first so that a failure answers an error with the conversation still in place: the chat client's retry passes the ownership check again and finishes, and `deleteConversation` is idempotent. In the other order, a failed admin delete would leave records nothing can reach any more.

**`sweep()` on the handlers.** `createChatHandler` returns `{ GET, POST, DELETE, sweep }`. `sweep({ idleDays?, limit?, signal? })` does, in bounded batches:
1. with a store that has `sweep` (not `openaiConversations()`): `conversations.sweep(idleSince, batch)`, then `admin.store.deleteConversation` for each conversation it returned and `deleteFiles` for their files;
2. `admin.store.sweep(…)` with the admin retention.

It resolves to `{ conversations, files, records, more }`, where `more` says a later call has work left. This is the sweep helper the ROADMAP asked about: **yes, in core,** because it needs the gateway's `deleteFiles`, which stays internal (ADR-0026), and the app should not import `openai` to finish what core started. The app's cron route imports its handlers from a module of its own (a route file may export only HTTP methods) and calls `sweep()` behind its own secret, such as Vercel's `CRON_SECRET`. askdare still schedules nothing.

A conversation a store's `sweep` deleted before `deleteConversation` failed leaves records behind that nothing points at; the admin store's own retention removes them. That is the only orphan path, and it is bounded by `retentionDays`.

**Retention.** `admin.retentionDays` (default **30**) for records, and 400 days for daily rows, which hold no personal data. Nothing is deleted unless the app calls `sweep()` on a schedule, so `askdare doctor` warns when an admin store's oldest record is older than its retention (`diagnose()`).

A turn that finishes after its conversation was deleted may still write a turn or transcript record. Retention removes it; core does not check the conversation again before each write.

### 5. What the dashboard can show from this

Cost per bot, day and model (`days`, priced by the app); ratings, new conversations, leads and handoffs by state over time (`days`); the 👎 answers with comments (`ratings`); the most expensive conversations (`conversations`, ordered by tokens); a review of a conversation, from its transcript records, or, without them, from the conversation store's `page()` (ADR-0024), which core reads for the console (decision 8).

"Unanswered questions" counts completed turns with no citations from bots with knowledge, plus withheld or failed ones. It is a heuristic and the dashboard calls it one. "Resolution rate" is the share of new conversations without a handoff, per bot and day: one minus handoffs (any final state but `limited`) over new conversations. It is a daily ratio, not a per-conversation fact, since handoffs aren't tied to conversations in the store (decision 6).

### 6. Handoffs and leads: counts only

The admin store keeps **no lead values and no handoff contents** in 0.7. [ADR-0031](0031-forms-and-leads.md) decides that askdare stores no form values: they pass from the request to `onLead` or `onHandoff` and are gone. The admin store follows it.

- **What is kept:** a counter per bot and day of leads, and of handoffs by ADR-0030's final state (`sent`, `saved`, `unavailable`, `failed`, `limited`), through `count()`. No conversation ID, visitor pseudonym, reason, trigger, form name, contact details or values.
- **A handoff saved as a message** (ADR-0031's `source.kind: 'handoff'`) counts as a handoff in state `saved`, not as a lead. Leads count only forms the model offered, so one submission is counted once.
- **Erasure:** the counters hold no personal data, so `deleteConversation` leaves them, and `sweep` removes them with the other daily rows (400 days).
- **Apps that want the details** keep them through their own `onLead` and `onHandoff`, which stay the place leads and requests go.

### 7. Stage 1: the console route

- **Off by default.** `admin.console` turns it on. Without it, every `<basePath>/admin…` path answers 404 like any unknown path.
- **Paths:** `GET <basePath>/admin` (the page), `GET <basePath>/admin/console.<hash>.js` and `.css` (the app), and `POST <basePath>/admin/api/<action>` (JSON). No `GET` returns data.
- **Built and inlined like the widget app.** A separate Preact app in `src/admin-console/`, built by Vite and turned into its own generated module by `scripts/inline-assets.mjs`, as `widget-app/` is. The handler loads that module with a dynamic `import()` only when the console is on, so apps without it don't evaluate it. The library reads no files at runtime. The console has its own gzipped budget, **30 KB**, checked in `inline-assets.mjs`.
- **Contents:** as ADR-0016 lists: the resolved configuration, `doctor` from the page, the playground, the test questions. With an admin store, a "Conversations" view uses the review read of decision 8. With `@boldare/askdare-admin`, the dashboard (decision 9).
- **The configuration view is an allowlist.** Core builds it from fixed fields of the resolved bot (model, instructions, tool names, vector store and index IDs, limits, texts per language, widget settings) and shows nothing else. Environment values, keys and secrets never reach it, and a field added to `defineBot` later stays hidden until it is added to the list. The resolved instructions come from `server/explain.ts`.
- **Playground turns** run through the normal turn path with the bot's limits and budgets, appear in `onUsage`, and are recorded with `source: 'console'`. Their owner is `admin:<hmac of the admin subject>`, so no visitor can resume them. The page deletes its conversation when it is closed (best effort), and retention catches the rest.

### 8. Access and headers

**Two ways in;** at least one must be configured when `admin.console` is set, or the console answers a setup error (checked on first use, like the other secrets, so `next build` never needs them; amended in c5):
- **A secret.** `ADMIN_SECRET`: at least 32 characters, different from `CHAT_SECRET` and `IDENTITY_SECRET` (checked at the first request, as the other secrets are). It is a separate secret because it is typed into a browser, and `CHAT_SECRET` mints every token. The page keeps it in memory only.
- **An identity allowlist.** `admin.console.allow: ['user-id', …]`, matched against `sub` of an identity JWT ([ADR-0009](0009-visitor-identity.md)) signed with `IDENTITY_SECRET`, with the audience `askdare:admin` and at most 10 minutes between `iat` and `exp`. (Amended in c5 from `askdare-admin`, which a bot ID may equal: a colon keeps every chat identity token out.) The app's own admin page, behind its sign-in, signs one and links to `<basePath>/admin#identity=<jwt>`. The fragment reaches neither the server, nor logs, nor a `Referer`, and the console removes it from the address bar at once.

**Sessions.** The page exchanges either credential at `POST admin/api/session` for an **admin token**: a JWE under `CHAT_SECRET`'s keys with its own type (`askdare-admin+jwt`) and audience, valid 15 minutes, held in memory, sent as `Authorization: Bearer` on every request. No cookies, no storage: a reload signs in again.
- The token carries a fingerprint of `ADMIN_SECRET` or the allowlisted subject. Rotating the secret, or removing a user from `allow`, ends their sessions at the next request.
- Session requests are rate-limited per IP and across the app in the limits store (5 a minute, 20 an hour); a wrong secret is compared in constant time; the kill switch closes the console too.
- **Every admin request is checked by askdare,** whatever the app's own sign-in does (ADR-0016).

**No raw conversation IDs in the browser.** Lists give the console sealed references (JWE, `askdare-admin-ref+jwt`, bound to the admin session's lifetime), and the review read takes only those. This keeps ADR-0004's rule that a browser never chooses a conversation ID, for the owner's browser too.

**Headers** on the page and every API answer: `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`, `X-Robots-Tag: noindex`. The hashed assets hold no configuration and are the same for every install, so they may be cached (`immutable`). API requests are JSON `POST`s with a Bearer token and get no CORS, as the chat route.

### 9. Stage 2: `@boldare/askdare-admin`

The add-on is the dashboard, plugged into the console rather than mounted as a second app:

```ts
// app/api/chat/[...path]/route.ts, or the module the cron route also imports
import { adminDashboard } from '@boldare/askdare-admin';
import { postgresAdminStore } from '@boldare/askdare-postgres';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  conversations,
  admin: {
    store: postgresAdminStore({ pool: db }),
    transcripts: true,
    retentionDays: 30,
    console: { allow: ['user_123'], dashboard: adminDashboard({ prices }) },
  },
});
```

- `adminDashboard()` returns an `AdminDashboard` value: the dashboard's inlined script and stylesheet (built and inlined in the add-on's own build, with its own budget) and its read handlers, which take the `AdminStore` and a validated query. Core serves the assets under the console, checks access, then calls the handlers. One route, one sign-in, one set of headers, one place where access is checked.
- `AdminDashboard` is the one core type that exists for the add-on. It is public (ADR-0006) and versioned with core; the add-on declares a peer range on core.
- `prices` maps model IDs to prices per million input, cached input and output tokens, as the app's own values; the dashboard shows "no price" for a model it lacks.
- **Not in it:** hooks (decision 3), storage (a1, a2), anything from `next` or `openai`, a route of its own.

### 10. Budgets and import boundaries

- **The loader and the React entry don't change.** Nothing under `embed/`, `react/`, `chat/` or `widget-app/` imports `admin/` or `admin-console/`, and the widget app's bundle stays as it is. The existing budget checks (`inline-assets.mjs` for the loader, `react-size.mjs` for React) are the proof; c5 adds an import-boundary check (a lint rule or a test over the built entries) so the rule is enforced, not only measured.
- The console may import from `chat/` (the protocol client) for the playground. Never the reverse.
- The console's code lives only in its generated module, reached by dynamic `import()`. The `@boldare/askdare/next` entry grows by the `admin` option and the handler code for it, not by the console's assets.

### 11. Public surface

Added to ADR-0006 when the tasks land; names final there:
- **`@boldare/askdare`:** `AdminStore` and its record, query and page types; `memoryAdminStore`; `AdminDashboard`.
- **`@boldare/askdare/next`:** the `admin` option (`store`, `transcripts`, `retentionDays`, `console` with `allow` and `dashboard`); `sweep` on the returned handlers.
- **`@boldare/askdare/testing`:** `adminStoreContract`.
- **The add-ons:** `postgresAdminStore`, `upstashAdminStore` and `adminDashboard`.
- **The environment:** `ADMIN_SECRET`.

## As built in 0.7

Amended on 2026-11-27 (task z1), where the code differs from the decision above. The names in [ADR-0006](0006-support-matrix-and-versioning.md) are final.
- **Decision 2, the port:** `AdminTurnRecord` has `unanswered: boolean`. Core computes decision 5's heuristic, since a store can't know whether a bot has knowledge, and stores only count the flag. `ratings()` resolves to `AdminStoredRating` (a rating that is `up` or `down`, never `null`). The query and option types are named (`AdminConversationQuery`, `AdminRatingQuery`, `AdminSweepOptions`, `AdminDays`), and so are `AdminSource`, `AdminCheckOutcome`, `AdminHandoffState`, `AdminHandoffCounts` and `AdminTranscriptCitation`. `diagnose()` keeps `ConversationStoreCheck`.
- **Decision 2, the stores:** `postgresAdminStore` and `upstashAdminStore` take their own `retentionDays` (default 30). Postgres uses it only for `diagnose()`, to warn when the oldest record is older; Upstash also lets a conversation's keys expire that long after its latest record, as a backstop when `sweep()` doesn't run. The docs ask for the same value as `admin.retentionDays`. Stores refuse a bad query with a plain `Error` or `RangeError`, since `AskdareError` isn't exported. Upstash breaks a tie of equal tokens and equal `lastAt` by the conversation ID's hash, not the ID; the contract doesn't pin that order.
- **Decision 7, the console's contents:** the configuration, `doctor`, the playground, the conversation review and, with `@boldare/askdare-admin`, the dashboard. ADR-0016's test questions per bot are not in 0.7: they need a configuration surface this ADR doesn't define. The playground doesn't show the turn's usage, which reaches `onUsage` only after the stream closes.
- **Decision 8, sign-in:** the identity token's audience is `askdare:admin`, not `askdare-admin`, which a bot ID may equal: the colon keeps every chat identity token out. Whether `ADMIN_SECRET` or `allow` is set is checked on the console's first request, as a setup error through `onError`, not when `createChatHandler` runs, so `next build` passes without the secret. `allow` without `IDENTITY_SECRET` warns once.
- **Decision 9, how the dashboard mounts:** core serves `adminDashboard()`'s assets at `<basePath>/admin/dashboard.<hash>.js` and `.css` (`immutable`, with the console's headers) and its handlers at `POST <basePath>/admin/api/dashboard/<action>`. The dashboard script sets `globalThis.askdareAdminDashboard.mount(element, host)`, which the console calls when its Dashboard view opens; `host.call` and `host.review` are all the dashboard sees, never the token or a URL. A handler's error maps by its `code`: `invalid_input` to `400`, `not_found` to `404`, anything else to `500`. This contract is internal (ADR-0006).
- **Decision 10:** the dashboard has its own budgets in the add-on: 12 KB for its script and 4 KB for its styles, gzipped.

## Settled with the maintainer (2026-11-26)

The questions left open in the first draft, all settled as recommended:
- **Core writes the records** from the reports the hooks get (decision 3); `@boldare/askdare-admin` wires no hooks.
- **The dashboard plugs into the console** (decision 9), so `AdminDashboard` is a public core type.
- **A new `ADMIN_SECRET`** for the secret sign-in, not a token derived from `CHAT_SECRET` (decision 8).
- **Raw conversation IDs** key the records on the server; the browser gets sealed references.
- **The numbers:** 30-day record retention, 400 days for daily rows, a 30 KB console budget, sign-ins limited to 5 a minute and 20 an hour.
- **"Unanswered questions"** is the heuristic of decision 5.
- **`sweep()` on the returned handlers** (decision 4), with the cron route importing the handlers from a module of its own.
- **Leads aren't stored** in 0.7, consistent with ADR-0031: the admin store counts leads and handoffs per bot and day, with no values (decision 6).

## Consequences

- **The "transcripts outlive a deleted conversation" gap closes** for transcripts kept in the admin store, once c5 ships. Transcripts an app keeps through its own `onTranscript` are still the app's to delete; the docs point those apps at `admin.transcripts`. The `onConversationDeleted` fallback of ADR-0016 is not needed unless the admin store slips past 0.7.
- **Apps on the default OpenAI store** get delete-by-conversation but no conversation sweep: their admin records are swept by age only, as ADR-0003's consequence 1 still holds.
- **Core grows** by the port, the memory store, the write and delete paths and the console's handler code, all server-side. The console's own UI is a separate inlined module with its own budget.
- **A second secret** (`ADMIN_SECRET`) to generate, store and rotate for apps that use the secret path. Apps with the identity path need none.
- **The console is the first browser page that shows server configuration** and stored transcripts. It gets `/security-review` before c5 merges, and `THREAT_MODEL.md` its section (drafted here, finished in c5).
- **Upstash keeps aggregates at write time,** so a dashboard query is a handful of reads, but adding a new query later means a backfill or a "from this version on" note. The fixed query list is the price of supporting a key-value store.
- **The dashboard's numbers are tokens priced by the app.** Owners who don't pass prices see tokens only.

## Alternatives considered

- **The add-on wires hooks into the store** (`onUsage: admin.onUsage`, as the a3 brief and ADR-0016 imply). Two registrations that can drift: a store fed by hooks but missing from the handler would never see a delete. One `admin.store` option closes that.
- **The dashboard as a second app the site mounts** (`createAdminHandler` in its own route, or React pages in the site). Two places to check access, two sign-ins, two sets of headers, and either a public access-check helper from core or a copy of it in the add-on. Plugging into the console keeps one.
- **Delete through an `onConversationDeleted` hook** instead of the port. ADR-0016 already rejected it as a second public way to the same end; it stays the fallback.
- **A `POST <basePath>/sweep` route** for cron services to call. A new authenticated public endpoint, while the app's cron route already has its own secret and a function call is enough.
- **Using `CHAT_SECRET` (or `doctor`'s token) to sign in.** `CHAT_SECRET` typed into a browser would put every token's key there; `doctor`'s token needs the CLI.
- **Keying records by the conversation's pseudonym**, as `onUsage` reports it. Reviews and deletes need the store's real ID, and core has it; the browser never sees it (decision 8).
- **Storing lead values or handoff records in the admin store,** so the dashboard could list them. It would contradict ADR-0031's "askdare stores no values" and put contact details in a second place to erase. Apps keep them through `onLead` and `onHandoff`.
- **Storing money instead of tokens.** It would put a price table in the library and make history wrong whenever prices change.
- **Free-form queries (SQL in the add-on).** Postgres could answer them, Upstash couldn't, and the contract suite couldn't hold both to one behaviour.
