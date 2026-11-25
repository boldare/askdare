# ADR-0024: Conversations stored outside OpenAI: the `ConversationStore` port

- **Status:** Accepted on 2026-11-25 (task z1), as built by tasks 1, 2, a2, 3a, e1 and 4. Decisions 6 and 10 are amended below ("As built").
- **Date:** 2026-11-23
- **Extends:** [ADR-0003](0003-conversation-state.md). The OpenAI Conversations API stays the default, with no database. ADR-0003's rule "always send `store: true`" and its consequences 1 to 3 hold only for that default (decision 4 below).
- **Evidence:** the tasks that built it (below); spike S7 ([findings](../../spikes/s7-store/FINDINGS.md)); replay needs from S6a ([findings](../../spikes/s6-claude/FINDINGS.md), Q3) and S6b ([findings](../../spikes/s6b-open-responses/FINDINGS.md), section 2).

## Context

ADR-0003 named a `ConversationStore` port but the code never grew one: creating, listing, deleting and settling conversations are methods of `ModelGateway` (`src/gateway.ts`), and every turn runs inside an OpenAI conversation. That blocks four things on the roadmap:
- **Data residency and zero data retention.** Conversations are not ZDR-eligible, so a ZDR organisation or an EU-only setup can't use askdare today.
- **Retention and admin.** OpenAI has no endpoint that lists conversations, so nothing can sweep old ones, and admin reviews (ADR-0016) end when OpenAI's copy is deleted.
- **Other providers.** Claude (S6a) and Open Responses endpoints (S6b) keep nothing between requests; they need the whole history replayed from somewhere.
- **Long history.** `listMessages` reads the latest 100 items and stops.

Spike S7 built the port with three implementations (memory, Postgres, OpenAI Conversations) and one shared contract suite, 31 of 31 tests green, and ran the same 20 turns both ways. Replaying from Postgres with `store: false` matched conversation mode on cost (0.0135 vs 0.0138 USD) and recall, kept 96.9 % of input cached, and finished turns about 1 s faster.

## Decision

1. **A public `ConversationStore` port** (S7's `port.ts`, names final in the implementing task):
   - `create(owner)`, `info(id)`, `context(id, { maxItems? })`, `append(id, items, { expect? })`, `page(id, { before?, limit? })`, `delete(id)`, and the optional `sweep(idleSince, limit)` and `diagnose()`.
   - `owner` is `{ botId, owner }`, where `owner` is `visitor:<id>` or `user:<hmac>` (ADR-0009).
   - Items are provider-neutral: messages with parts (text with citations, page context, file references, refusals), function calls, function call outputs, and `native` items for opaque provider state (encrypted reasoning, later thinking blocks or compaction items), tagged with provider and model family.
   - `context()` returns one of two kinds. **Provider stores** return a reference: the provider records the model's items itself. **Item stores** return the items to replay. Both carry a version.
   - The port, its item types and the error a stale `expect` raises contain no `openai` types. The mapping between stored items and Responses items lives in `src/openai/` (ADR-0002).
   - **Names as implemented** (task 1): `ConversationStore`, `ConversationOwner`, `ConversationInfo`, `StoredItem`, `StoredPart`, `StoredCitation` (with `sourceId`, ADR-0025), `PositionedItem`, `ConversationContext` (the turn context), `ConversationPage`, `ConversationStoreCheck` (what `diagnose()` returns) and `VersionConflictError`, from `@boldare/askdare`; `openaiConversations` from `@boldare/askdare/next`, next to `createChatHandler`, since it needs `openai`. A store's conversation IDs are letters, digits, `_` and `-`, at most 128 characters, so they fit the resume token's check.
2. **Implementations:**
   - `openaiConversations()`: the default, a provider store. Today's behaviour, unchanged.
   - `memoryConversations()`: an item store for tests and local development. In production it warns that it is per instance, as the in-memory rate-limit store does.
   - `postgresConversations({ … })` in a new add-on, **`@boldare/askdare-postgres`**, with `pg` as its only dependency. The same package holds the pgvector index of [ADR-0025](0025-knowledge-index.md), as a separate export, so one `DATABASE_URL` serves both. This replaces the package name `@boldare/askdare-store-postgres` from ADR-0003.
   - The store is chosen in `createChatHandler({ conversations })`, on the server only. The client never chooses it (ADR-0004).
3. **Rules for item stores:**
   - Turns send `store: false` and replay the stored items. Nothing of the conversation stays at OpenAI beyond its 30-day abuse-monitoring retention of requests, so ZDR organisations work.
   - **Append-only and deterministic:** a stored item is never rewritten, tool outputs included, and the same item always maps to the same request JSON. That keeps the prompt cache and the replayed reasoning valid.
   - **Write order:** read the context; append the visitor's message with `expect` before the first model call; after each step, append its output items and the outputs of its calls **in one atomic append**; append the `suggest_replies` outputs with the last step; guardrail notes (ADR-0022) are appended like any other item. A crash loses at most the step in flight, and a call is never stored without its output.
   - **Concurrent turns** on one conversation: the loser of an `expect` conflict writes nothing and ends with the existing `rate_limited` code, as ADR-0022's hold does.
   - **Reasoning** is replayed only to the model family that wrote it.
   - **No `truncation`.** Item stores replay the whole conversation, which `limits.maxTurns` already bounds; a request that still overflows ends with `error.conversationTooLong`, as today. `context({ maxItems })` cuts its window forward to a visitor message so it never starts mid-turn; it is what compaction (spike S9) or a later option builds on.
4. **ADR-0003 under an item store:** its "always send `store: true`" rule applies to `openaiConversations()` only. Consequence 1 (no retention) and 2 (data stays at OpenAI) don't apply. Consequence 3 changes as decision 3 says.
5. **Ownership** becomes a real check. The resume token is unchanged (a JWE whose `cid` is now the store's ID), and the server compares `info(id)`'s bot and owner with the token's claims. On a mismatch it answers exactly as for an unknown conversation. Adopting an anonymous conversation at sign-in (`reassign`) is not in 0.6, so an adopted conversation keeps its visitor as owner; a signed-in user's token, which follows them through new visitor IDs, therefore matches its own `user:` owner or any `visitor:` owner, never another user's. Conversations a signed-in user started before 0.6 are stored under their visitor too.
6. **Deletion and retention:**
   - `delete(id)` returns the file IDs its visitor messages reference, and the server deletes those files through the gateway, as today.
   - `sweep` deletes conversations idle since a time and returns their IDs and file IDs. The library can't schedule work, so the add-on exports it for a cron route or job; the docs show both. A sweep goes through the same deletion path as `DELETE /conversation`, so the admin store's transcripts and ratings go too (ADR-0016).
   - `openaiConversations()` has no `sweep`; ADR-0003's consequence 1 stands for it.
7. **History beyond 100 items:** `POST /history` takes an opaque `before` cursor and answers one page **of whole turns**, newest page first, oldest first within it, plus the next cursor when there is more. Both stores page: OpenAI with `items.list` cursors, item stores with `page()`. An additive change within protocol v1.
8. **Citations are stored on the text part** in item stores (title, URL and source ID), so reloaded history needs neither `file_search_call.results` nor a search.
9. **Schema:** the Postgres add-on keeps its schema in code and creates or upgrades it only through an explicit `migrate` (an exported function and a bin). It never migrates at request time. `doctor` reports a missing or older schema.
10. **Contract suites ship** in a new subpath, `@boldare/askdare/testing`: the conversation store suite, the rate-limit store suite (today only reachable by relative import) and the knowledge index suite (ADR-0025). They take the test runner's `describe`, `it` and `expect`, so the subpath depends on no runner. The suites delete everything they create, also after a failed test (S7 leaked one empty conversation without that).
11. **What stays separate:**
    - **`AdminStore`** (ADR-0016): reports, ratings and optional transcripts. It may share a database with the conversation store, never an interface. With an own store, `onTranscript` and admin reviews can read from it, which removes ADR-0016's caveat that reviews end when OpenAI's copy is deleted.
    - **Stream resume** has its own port ([ADR-0027](0027-stream-resume.md)): a different lifetime and write rate, and the OpenAI default needs it too.
12. **`ModelGateway` shrinks.** `createConversation`, `listMessages`, `deleteConversation` and `settleAnswer` move onto the store; `runTurn` takes the turn context. `ModelGateway` stays internal in 0.6 ([ADR-0026](0026-provider-path.md)).
13. **Public surface** (added to ADR-0006 when this is accepted): the `ConversationStore` port and its item and context types, `openaiConversations`, `memoryConversations`, the `conversations` option of `createChatHandler`, the `@boldare/askdare/testing` subpath with its three suites, `@boldare/askdare-postgres`'s `postgresConversations` and `migrate`, and the `before` cursor of `POST /history`.

## As built in 0.6

- **Names** are those of decision 1. `ConversationStore.sweep` also takes an optional `signal`, as the other methods do (z1). The OpenAI store's IDs are `conv_…`, the Postgres store's lowercase UUIDs, the memory store's UUIDs. An answer's ID in an item store is `itm_…`, so the feedback token takes `msg_…` and `itm_…`.
- **Stateless turns** (task 2): `turn.ts` reads `context()` first and branches on its `kind`. A provider context keeps 0.5's request (`conversation`, `store: true`, `truncation: 'auto'`, the repair of dangling calls). An items context sends `store: false` with the replayed history, appends the visitor's message with `expect` before the first model call and each step's output with its call outputs in one append. Of the model's other output, only its reasoning (replayed only to the model family that wrote it), its file searches and compaction items ([ADR-0029](0029-compaction-for-item-stores.md)) are stored, as `native` items; any other type is dropped, so nothing askdare didn't request comes back as input. A lost `expect` race ends with `rate_limited` and a retry after 5 s.
- **A store that fails after `info()` succeeded** (task 2): core asks `info(id)` again; `undefined` answers as for a deleted conversation (`not_found`, `error.conversationGone`), anything else keeps the original error. The port has no not-found error type: a store only has to make `info()` answer `undefined`.
- **Decision 6, amended: a sweep is the app's call.** `sweep` returns the conversations it deleted and their file IDs; the app's cron route or job deletes the files and its own transcripts. Core has no public helper that deletes through the gateway, and the admin store doesn't exist yet (0.7), so "the same deletion path as `DELETE /conversation`" holds only for the store's rows. The [own-your-data guide](../own-your-data.md#8-sweep-old-conversations) and the Postgres add-on's README show the route. A visitor's `DELETE /conversation` calls no hook either: transcripts an app keeps (`onTranscript`) outlive it until the app's retention removes them. Deleting them with the conversation is the 0.7 admin store's job ([ADR-0016](0016-admin.md), as decided in z1).
- **Decision 7** (task 3a): the `before` cursor is a JWE sealed to the bot and the conversation (`typ: askdare-history+jwt`), valid as long as the resume token; a cursor of another conversation, even the same visitor's, answers 400 `invalid_input` with `error.history`. A page is at most eight store reads; a turn of more than about 800 items is shown split.
- **Decision 9:** `postgresConversations().diagnose()` reports the schema status and, for an unreachable database, the error code only. `openaiConversations().diagnose()` checks that the key can create and delete a conversation, so `doctor` makes a test conversation at OpenAI only for apps on that store (z1; before, every bot made one, whatever its store).
- **Decision 10, amended:** `@boldare/askdare/testing` holds four suites, the turn log's of [ADR-0027](0027-stream-resume.md) included, all called as `(name, create, { describe, it, expect, …options })`, and the fixtures `fakeEmbedder` and `knowledgeDocument`.
- **Decision 12:** `ModelGateway` lost the four methods and gained `deleteFiles`; it stays internal. Its OpenAI-named fields (`safetyIdentifier`, `vectorStoreId`, `answerItemId`) are not renamed yet: they are, before the port is made public ([ADR-0026](0026-provider-path.md), decision 5).
- **Decision 13:** the surface is listed in [ADR-0006](0006-support-matrix-and-versioning.md).

## Evidence

- **Contract suite:** `conversationStoreContract`, with its paging and compaction cases, passes for `memoryConversations()` and, against Postgres 17 with pgvector 0.8.7 in CI, for `postgresConversations()` (a2). The provider variant for `openaiConversations()` runs live with `ASKDARE_CONTRACT_OPENAI=1 pnpm smoke`, which no 0.6 task ran.
- **Turns:** unit tests run the turn loop in both modes (task 2), and `e2e/postgres.spec.ts` (e1) runs a stateless conversation with a tool call against Postgres in the browser, reloads it and deletes it. Paging is checked on both stores by reading every page and comparing with one read of the whole conversation (3a). The live smoke test of a stateless conversation (`gateway.smoke.ts`) was written in task 2 and run only in its compaction variant (task 4, on `gpt-6.1-terra`).
- **The guide:** d1 followed [Own your data](../own-your-data.md) on a fresh `create-next-app` with the packed packages, a pgvector container and the mock OpenAI server: migrate, a cited answer from Postgres, a reload, `doctor`, transcripts and the cron sweep.

## Consequences

- A site can keep every conversation in its own Postgres, with retention, and run with ZDR or in the EU. Sites that set nothing keep today's setup with no database.
- Item stores send larger requests: the whole history, 32 KB at turn 20 in S7, of which 22 KB was encrypted reasoning. They also add about 40 ms of store reads and writes per turn (local Docker in S7). The cost is the same, since the replay is almost entirely cached.
- An own store is one more service to run and back up, and the site owns its retention and its `migrate` step. The docs cover Neon, Supabase and Heroku Postgres.
- The turn loop gets one code path with two modes. Recorded-stream tests have to run in both.
- Claude needs its assistant content replayed exactly (thinking blocks with signatures, text with citations). The `native` item can carry it; how exactly is decided with the native Claude adapter, not in 0.6.
- With the default store, OpenAI still serialises turns (`conversation_locked`), and `MAX_REPAIRS` stays for calls OpenAI writes before we answer them.

## Alternatives considered

- **OpenAI Conversations as an item store** (list the items each turn, replay statelessly): listing 62 items took 567 ms on top of a 2.6 s first token, and the API appends at most 20 items per request, so appends can't be atomic (S7).
- **Store each provider's native transcript** (Responses items, Claude message arrays): history display, ownership and paging would need a mapper per provider. Neutral items with an opaque `native` escape hatch keep the store provider-free.
- **One interface for conversations and admin data:** different lifetimes, writers and readers. Two ports that can share one database.
- **Postgres in core instead of a port:** every site would need a database, against ADR-0003's "an API key and a secret are enough".
- **Migrating the schema on first use:** a cold start on serverless would race other instances and need DDL rights for the app's database user.
- **Two Postgres packages** (store and index): two installs, two migrations and two connection pools for what S8 found to be one database.
