# Spike S7: conversations stored outside OpenAI

- **Brief:** [`tasks/0.6-s7-conversation-store.md`](../../tasks/0.6-s7-conversation-store.md). Feeds the `ConversationStore` ADR that task P1 writes.
- **Date:** 2026-11-23. **Model:** `gpt-6.1-terra` (what the starter and site use; named only in this spike). SDK `openai` 7.56.0, `pg` 8.23.1, Postgres 17 in Docker (host port 54327).
- **Cost:** about **0.04 USD**, computed from `usage` (main run 0.027 USD, probes about 0.015 USD). Not compared with the billing dashboard.
- **Cleanup:**
  - Deleted: every file the spike uploaded (main run 1, token probe 1, contract suite 2), and every conversation whose ID it had (main run 1, paging probe 1, token probe 1, every contract-suite conversation).
  - **Leaked: one empty conversation.** The first contract run against OpenAI used fake file IDs. OpenAI rejected the append with a 404, and the test ended before its delete. That conversation has no items, only the metadata `askdare_bot: contract-bot` and `askdare_owner: visitor:contract`. The Conversations API has no list endpoint and its ID wasn't logged, so it can't be found or deleted. The suite now deletes every conversation it creates in an `after` hook, including after a failed test.
  - Stateless turns send `store: false`, so they leave nothing at OpenAI. The conversation-mode turns' responses stay stored at OpenAI for up to 30 days, as ADR-0003 already states.

## Verdict: **go**

A small `ConversationStore` port works for both cases:
- the default `openaiConversations()`, where OpenAI keeps the conversation and records the model's items during each response;
- stores that keep the items themselves (Postgres, memory), replayed with `store: false`. These are the only kind S6a (Claude) and S6b (Open Responses) can use.

Stateless turns from Postgres matched conversation mode on cost and recall. Time to first token was about the same, and whole turns were faster (table below). Encrypted reasoning replays cleanly. The whole port contract runs against memory, Postgres and OpenAI: 31 of 31 tests pass.

Conditions for the ADR:
1. **Each step's items are written in one atomic append** together with the outputs of their calls.
2. **The replay is append-only and deterministic**, as described in "What is stored".
3. **Stream resume is a separate port.** It doesn't belong in `ConversationStore`.

## Measurements

### Question 3: the same 20 turns, interleaved (`turns.ts`, `results-turns-gpt-6.1-terra.json`)

The same 20-message support conversation ran in both modes. The modes alternated which went first on each turn. The conversation had 7 function calls in 6 turns, an image attachment in turn 3, and instructions of about 1,700 tokens, so the prompt cache applies. The request shape matches `turn.ts`: `stream`, `truncation: 'auto'`, `safety_identifier`, `prompt_cache_key`, a strict function tool, and `tool_choice: 'none'` on the last step.

| | `conversation` (today) | stateless, Postgres replay |
|---|---|---|
| Time to first text, median / p90 | 2.73 s / 7.39 s | 2.97 s / 6.15 s |
| First-step time to first token, median | 2.57 s | 2.62 s |
| **Whole turn, median** | **4.78 s** | **3.56 s** (faster on 18 of 20 turns) |
| Store reads and writes per turn, median | 0 (inside the API call) | 39 ms (local Docker; 1 read, 2–3 appends) |
| Input tokens (cached share) | 68,808 (94.5 %) | 75,738 (96.9 %) |
| Output tokens (reasoning) | 1,182 (328) | 1,387 (461) |
| Cost of 20 turns | 0.0138 USD | 0.0135 USD |
| `input_transformations` (reasoning dropped) | none | none |
| Effective `reasoning.context` | `all_turns` | `all_turns` |
| Largest request body (`input`) | 669 B | 32 KB |
| Recall at turn 20 (name, order of the scratched table) | correct | correct, nearly the same wording |

- **Caching survives replay.** From turn 2 on, every stateless step read all but the last few dozen tokens from the cache, and no reasoning item was ever dropped for `prefix_mismatch`. That depends on the replay being deterministic: the same stored item always maps to the same input JSON, and the visitor's new message goes in through the same mapping.
- **Stateless sends 4–6 % more input tokens,** from turn 3 on. That's the replayed encrypted reasoning: `probe-tokens.ts` counted 2,070 tokens for the full replay, 1,986 without the reasoning items, and 1,985 for the conversation's own items replayed. The extra tokens are almost all cached, so the cost is the same.
- **Whole turns are about 1 s faster stateless,** while the first token comes at about the same time. Conversation mode spends the extra time after the last text delta, before `response.completed`, most likely while it writes the items into the conversation. This is one run of 20 turns; treat it as a hint.
- **Larger requests:** a stateless request resends the whole history, 32 KB at turn 20 and 22 KB of it encrypted reasoning. That's fine for our turn limits, but a long conversation needs the replay window below.
- **Encrypted reasoning** comes back by default with `store: false`; `include: ['reasoning.encrypted_content']` isn't needed anymore (reasoning guide, "Preserve reasoning without stored responses"). Probe p3, with `reasoning.effort: 'low'`, varied the replay:

  | Replay variant | Result |
  |---|---|
  | Reasoning items with their `rs_…` IDs | worked; 0 tokens from the cache, but it was the probe's first request, so the cache was likely cold |
  | Without their IDs | worked; 1,912 of 1,915 tokens from the cache |
  | With a different `safety_identifier` | worked, no `end_user_mismatch` |
  | As if the model family had changed (items left out) | worked; 23 tokens fewer |

  Reasoning carries over only within a model family. The replay tags each reasoning item with its family (`gpt-6.1`) and leaves it out for any other family, which the API would do anyway.

### Question 2: what is stored (20-turn run, Postgres `jsonb`)

| Item | Count | Bytes on disk |
|---|---|---|
| Messages (20 visitor, 20 assistant) | 40 | 9.8 KB |
| Function calls | 7 | 1.1 KB |
| Function outputs | 7 | 2.3 KB |
| Encrypted reasoning (`native`) | 8 | **21.5 KB** |
| **Total** | 62 | **34.7 KB** |

- **For replay, a turn keeps:**
  - the visitor's message, with the page-context part and file references;
  - encrypted reasoning, as opaque native state;
  - assistant messages with their `phase`;
  - every function call and its output, byte for byte, because a changed output changes the prefix and drops reasoning (the guide "Keep the prefix unchanged");
  - guardrail notes (developer messages);
  - later, compaction items and hosted tool calls (`file_search_call`), also as native state.
- **For showing history only:** citations (titles and URLs), UI payloads and reply options. Today these are derived from tool calls and outputs, which are stored anyway (`history.ts`). With an own store, citations should be stored on the text part, because `file_search_call.results` are large and only needed to rebuild them. S8's own retrieval changes this anyway.
- **Not stored:** dynamic context (page URL, identity) stays in per-request `instructions` (ADR-0003). The visitor's typed text isn't duplicated anywhere else.
- **OpenAI stores the same turns as** 20 visitor messages, 20 answers, 6 calls, 6 outputs and 7 reasoning items. Its listing has no size.

### Question 1: write order and crashes (probes p1, p2)

- **p1:** a stateless replay with a call but no output gets `400 No tool output found for function call …`, the same as S1 found inside a conversation. The synthetic output from `turn.ts` repairs it.
- **p2:** the server "dies" after step 1, where the model called `lookup_order`, before that step's append. Only the visitor's message is stored. The next turn replays `user, user` and works: it called the tool again and answered.
- **The order that never leaves a dangling call:**
  1. Read the context (items and version).
  2. Append the visitor's message, with `expect: version`, before the first model call.
  3. After each step, append its output items and the outputs of its calls **in one append**, with `expect`.
  4. Append the `suggest_replies` outputs together with the final step's items. That replaces today's separate `storeOutputs`.
  5. `settleAnswer` appends the note, plus the replacement when there is one.

  A crash loses at most the step in flight, and a call is never stored without its output. `MAX_REPAIRS` stays for the OpenAI default, where OpenAI writes the call before we answer it.
- **Concurrent turns** (two tabs): the turn appends with `expect: version`, which is optimistic concurrency. The contract checks that exactly one of two appends at the same version wins and the loser writes nothing. The turn maps the loser to a `busy` error. Today OpenAI serialises turns itself (S5b saw `conversation_locked`), and `lockConversation` exists only for guardrails.

### Question 7: long history (probe p4, 140 items)

| | Page of 100 | Next page (40) | Writing 140 items |
|---|---|---|---|
| OpenAI `items.list(order: 'desc', after: <oldest id>)` | 675 ms | 310 ms | 3.7 s (20 per request) |
| Postgres keyset (`seq < $before order by seq desc limit`) | 2.4 ms | 0.8 ms | (local) |

- **Both page the same way:** newest page first, each page oldest first, and an opaque `before` cursor (an item ID at OpenAI, `seq` in Postgres). The contract checks that paging returns every item exactly once.
- **The history view should page by turn, not by item,** because `readTurns` needs whole turns for cards and options. Fetch a page, then extend it back to the visitor message that starts its oldest turn. A protocol change (`GET /conversation?before=`) belongs to 0.6 planning, not this spike.
- **The replay window** (`context({ maxItems })`) is cut forward to a visitor message, so it never starts mid-turn (contract-tested for every size from 1 to 12). With an own store it replaces `truncation: 'auto'`, which would drop items inside OpenAI and change the prefix. Starting the window at the latest compaction item (compaction guide) fits the same method.
- **Rejected: using OpenAI Conversations as an item store** (list the items each turn, then replay statelessly). A full listing took 567 ms for 62 items, on top of a first token of about 2.6 s, and the API appends at most 20 items per request, so appends can't be atomic.

### Question 5: deletion and retention

- `delete(id)` returns the file IDs from visitor messages, and the gateway deletes those files, as in `ModelGateway.deleteConversation` today. The stored items and the replay referenced the same `file_id`. Both stores returned it, and it was deleted (main run).
- **Retention:** `sweep(idleSince, limit)` deletes conversations idle since a timestamp and returns their IDs and file IDs. In Postgres it uses `for update skip locked`, so two sweeping instances and a live append don't block each other. OpenAI can't sweep: it has no list endpoint, which is ADR-0003 consequence 1 again.
- **`AdminStore` (ADR-0016) stays separate.** A sweep or delete reports the IDs, so the server can delete transcripts and ratings in the `AdminStore` the same way it does on `DELETE /conversation`. With an own store, `onTranscript` and reviewing a rated conversation can read from the store instead of OpenAI. That removes ADR-0016's caveat that reviews end when OpenAI's copy is deleted. The two ports can share one Postgres database but not one interface.

### Question 4: ownership and the resume token

- **The token doesn't change:** a JWE with `cid`, now our UUID instead of `conv_…`.
- **Ownership becomes a real check** instead of defense in depth. `info(id)` returns `botId` and `owner` (`visitor:<id>`, or `user:<hmac>` when signed in, ADR-0009), and the server compares them with the token's claims. On a mismatch it answers as if the conversation didn't exist, which `metadata: { bot, visitor }` couldn't enforce. Adopting an anonymous conversation at sign-in needs an `owner` update, a small addition to the port (`reassign(id, owner)`); it isn't in this sketch.
- **Encrypted reasoning isn't bound to the end user** (p3 replayed it under another `safety_identifier` with no transformation). It's opaque, but not an access control.

### Question 6: stream resume (probe p5)

- **What the store must keep:** the protocol events of the running turn (never raw OpenAI events), keyed by turn ID and sequence number, for minutes: turn timeout plus a grace period, then they expire. It must also be able to wake a waiting reader. The finished turn's items already land in the conversation store, so a visitor who comes back after the turn ended just reloads history.
- **Postgres prototype (local Docker):**
  - inserting 400 text deltas one by one took 186 ms (0.46 ms each);
  - batched in 20 flushes of 20 events, 12 ms;
  - reading the 150 events after a given sequence number, 2.2 ms;
  - a `LISTEN/NOTIFY` wake-up, 6 ms.

  It works, but it's write-heavy, short-lived data that needs a `LISTEN` connection per waiting reader, which serverless Postgres poolers handle poorly.
- **Recommendation:** a separate `TurnEventLog`/resume port shaped like `RateLimitStore`:
  - methods `append(turnId, events)`, `read(turnId, afterSeq)` and `wait(turnId, afterSeq, timeout)`, with a TTL;
  - an Upstash/Redis implementation (streams with `XADD`/`XREAD BLOCK` and `EXPIRE`) as the main one;
  - optionally Postgres (unlogged table, batched flushes) for sites that run only Postgres.

  It isn't part of `ConversationStore`: it has a different lifetime and write rate, and the OpenAI default needs it too.
- **Precondition, checked in the code:** `stream-turn.ts` runs the model call on the turn's `deadline` signal, not the visitor's request signal. So a turn already keeps running after a disconnect, and resume only needs the buffer plus an SSE `Last-Event-ID`. Whether serverless platforms keep the function alive after the response closes (Vercel `waitUntil`/`after()`) wasn't tested here.

### Question 8: contract tests (`contract.ts`)

Each store implementation runs 12 tests: 7 for item stores only, 1 for provider stores only, and the rest for all. Memory and Postgres pass 12/12; OpenAI Conversations passes 7/7 (the shared ones plus "returns a provider reference"). It makes no model calls and uploads 2 files, which it deletes.

- **All stores:**
  - create and `info`, with bot and owner;
  - unknown IDs return `undefined`, never another conversation;
  - order and round trip of appended items;
  - conversations stay apart;
  - paging returns each item once;
  - delete returns the attached file IDs and is idempotent.
- **Item stores:**
  - the context replays everything, with the version;
  - the replay window never starts mid-turn;
  - a stale `expect` is rejected and writes nothing;
  - of two concurrent appends at the same version, exactly one wins;
  - an item ID used twice is rejected;
  - `sweep` deletes only idle conversations.
- **Provider stores:** the context is a reference.

**Lessons for the library's suite:**
- The suite must delete what it creates even when a test fails, which the leak above showed.
- Stores that validate file IDs need real ones, through a `files` option.
- Comparisons ignore item IDs, because OpenAI assigns its own.

## ADR input

### The port (TypeScript sketch; the full version is in `port.ts`)

```ts
export interface ConversationOwner { readonly botId: string; readonly owner: string } // visitor:<id> | user:<hmac>

export type StoredPart =
  | { type: 'text'; text: string; citations?: readonly { title: string; url?: string; fileId?: string }[] }
  | { type: 'page_context'; text: string }
  | { type: 'file'; fileId: string; kind: 'image' | 'pdf'; name?: string }
  | { type: 'refusal'; text: string };

/** `id` chosen by the caller, unique per conversation (the turn knows its answer's ID before commit). */
export type StoredItem =
  | { id: string; type: 'message'; role: 'user' | 'assistant' | 'developer'; phase?: 'commentary' | 'final_answer'; parts: readonly StoredPart[] }
  | { id: string; type: 'call'; callId: string; name: string; arguments: string }
  | { id: string; type: 'call_output'; callId: string; output: string }
  /** Opaque provider state (encrypted reasoning, thinking blocks, compaction, hosted tool calls); replayed to the same provider and model family only. */
  | { id: string; type: 'native'; provider: string; family?: string; data: unknown };

export type TurnContext =
  | { kind: 'provider'; provider: string; ref: string; version: number } // the provider records model items itself
  | { kind: 'items'; items: readonly Positioned<StoredItem>[]; version: number }; // replay these, append everything

export interface ConversationStore {
  readonly name: string;
  create(owner: ConversationOwner, signal?: AbortSignal): Promise<string>;
  info(id: string, signal?: AbortSignal): Promise<ConversationInfo | undefined>; // botId, owner, createdAt, updatedAt, version
  context(id: string, options?: { maxItems?: number; signal?: AbortSignal }): Promise<TurnContext>;
  append(id: string, items: readonly StoredItem[], options?: { expect?: number; signal?: AbortSignal }): Promise<number>; // atomic; VersionConflict
  page(id: string, options?: { before?: string; limit?: number; signal?: AbortSignal }): Promise<{ items: readonly Positioned<StoredItem>[]; before?: string }>;
  delete(id: string, signal?: AbortSignal): Promise<{ fileIds: readonly string[] }>;
  sweep?(idleSince: number, limit: number): Promise<readonly { id: string; fileIds: readonly string[] }[]>;
}
```

- **No provider types:**
  - The mapping to and from Responses items (`openai-map.ts`) belongs in `src/openai/`.
  - `@boldare/askdare-store-postgres` implements the port with `pg` only and treats items as JSON. It indexes only `type` and item ID, and finds file IDs with a JSON path.
- **One turn loop for both kinds:**
  - The turn loop always produces the same items.
  - With `kind: 'provider'` it sends `conversation` + `store: true` and appends only the items the server writes: guardrail notes, `suggest_replies` outputs, and the turn's repair outputs.
  - With `kind: 'items'` it sends `store: false` and appends everything.
  - `ModelGateway`'s `createConversation`, `listMessages`, `deleteConversation` and `settleAnswer` move onto the store. The gateway keeps `runTurn`, which now takes a `TurnContext`.
- **Startup check:** a Claude or Open Responses gateway refuses a store whose context is `provider` (`kind: 'items'` is required).
- **Open for P1, from S6a's prototype:** Claude replays assistant content unchanged, with thinking blocks and citations. A thinking block fits `native`. For Claude's text citations, either the text part keeps a native copy for the same provider, or those citations become `native` too. Otherwise the replay changes the prefix. S6b decides whether Open Responses items can be the stored format as they are; the port above doesn't depend on that.

### What changes in ADR-0003

- **"Own storage is an add-on" becomes concrete:**
  - the `ConversationStore` port is public API (ADR-0006), with `memory()`, `openaiConversations()` (still the default; no database needed) and `@boldare/askdare-store-postgres`;
  - the contract suite ships like `rateLimitStoreContract`.
- **Ownership:** with an own store, the bot and owner check is enforced from `info()`, not defense in depth. The resume token is unchanged.
- **Consequence 1** (no retention, no admin browsing) holds only for the OpenAI default. Own stores sweep.
- **Consequence 2:** with an own store and `store: false`, nothing of the conversation stays at OpenAI. Only files and the 30-day abuse-monitoring retention of requests remain; ZDR organisations work.
- **Consequence 3:** with an own store, the replay window replaces `truncation: 'auto'` (cut at a visitor message, or later at the latest compaction item). Prompt caching works the same as in conversation mode (96.9 % vs 94.5 % cached here).
- **New rules for item stores:**
  - append-only and deterministic replay (never rewrite stored items, tool outputs included);
  - one atomic append per step with the call outputs;
  - `expect` versions against concurrent turns;
  - reasoning tagged with its model family.
- **The `store: true` rule** ("always send `store: true`") applies only to `openaiConversations()`. Item stores must send `store: false`.

### Out of scope, for P1 or later tasks

- Stream resume as its own port (above), and the protocol side (`Last-Event-ID`).
- History paging in the protocol (`before` cursor by turn).
- `reassign(id, owner)` for adopting a conversation at sign-in.
- Repository tooling: the `commit-msg` hook (`commitlint --edit {1}` in `lefthook.yml`) fails when the checkout path contains a space ("open source"). Quoting `{1}` should fix it. This spike's commits were checked with commitlint by hand.

## Files

- `port.ts`: the port and helpers.
- `memory-store.ts`, `pg-store.ts` with `schema.sql`, `openai-store.ts`: the three stores.
- `contract.ts`, `contract.test.ts`: the shared suite (`node --test`, with `S7_CONTRACT_OPENAI=1` for OpenAI).
- `openai-map.ts`: `StoredItem` ↔ Responses items.
- `turn.ts`: the turn loop in both modes.
- `turns.ts`, `probes.ts`, `probe-tokens.ts`: the measurements.
- `results-*.json`: measured output, with no item contents beyond fictional test answers and no encrypted content.
- `docker-compose.yml`: run `pnpm install --ignore-workspace`, then `docker compose up -d --wait`, then `node --env-file=.env turns.ts`.
