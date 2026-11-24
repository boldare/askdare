# ADR-0029: Compaction for conversations in our own store

- **Status:** Accepted on 2026-11-24, with the implementation of task 4 (see Evidence and the amendments to decisions 5 and 7)
- **Date:** 2026-11-23
- **Extends:** [ADR-0003](0003-conversation-state.md) (its S5 and S5b updates: compaction waits) and [ADR-0024](0024-conversation-store.md) (decision 3, the replay window). Under `openaiConversations()`, ADR-0003's decision stands unchanged.
- **Evidence:** spike S9 ([findings](../../spikes/s9-compaction/FINDINGS.md)); spikes S5 and S5b ([S5](../../spikes/s5-compaction/README.md), [S5b](../../spikes/s5b-compaction/README.md)).

## Context

S5 and S5b ruled out OpenAI's server-side compaction inside a `conversation`:
- OpenAI keeps the most recent ~64k tokens verbatim, so below that size compaction ran on every turn;
- each pass lost the prompt cache, so those turns cost 12–24 times as much;
- it delayed the first token by seconds;
- `file_search` answers lost their citations.

ADR-0024 lets askdare keep the items itself and replay them with `store: false`. ADR-0025 makes citations plain `[id]` markers with stable source IDs. Spike S9 measured compaction on that path.

- **Is it needed?** A realistic 50-turn conversation (`limits.maxTurns`) with own retrieval grew to 80.7k tokens on `gpt-6.1-terra` (113k on `gpt-6-luna`), 84 % of it search results. That is far below the context window, and latency barely grows, because 98 % of the input is cached. But cost per turn grows linearly: the conversation cost 0.31 USD, and turns 41–50 cost three times turns 1–10. `limits.ts` also charges cached tokens at full weight, so the default per-IP budget runs out at turn 13.
- **Stateless compaction works:**
  - every way S9 tried shrank the window to 3–5k tokens;
  - facts and `[id]` citations survived, with every ID resolving;
  - the cache missed only on the first step after a compaction, a prefix of a few thousand tokens;
  - over 50 turns it saved 27 % (terra, estimated) to 56 % (luna, measured) of the cost, and three to four times the budget tokens.
- **Where to run it:**
  - Inside the turn (`context_management`), the compaction pass delays the first token by 3–9 s.
  - After the turn, with the documented `compaction_trigger` input item, it reads the turn's cache (82.5k of 82.6k tokens), costs 0.0085 USD at 82k on terra, and takes 14–16 s that nobody waits for.
  - `/responses/compact` misses the turn's cache (0.086 USD on terra at 82k), because it has no `tools` field.

## Decision

1. **Item stores only.** Compaction applies when the conversation store returns items (ADR-0024). `openaiConversations()` gets none, and S5b's findings stand for it.
2. **Opt-in: `limits.compactAt`,** a token count, unset by default. `defineBot` accepts 20,000 to 272,000. The upper bound is the long-context price step; below the lower bound the compacted floor soon reaches the threshold. The trigger is the last step's `usage.input_tokens` of a turn. The library counts no tokens itself; S5b found that counting against a conversation locks it.
3. **Compact after the turn, off the critical path.** On the OpenAI path, when a turn's last step reached `compactAt`:
   - after the turn's lock is released, the handler's `waitUntil` runs one `responses.create`;
   - it sends the replayed window followed by `{ type: 'compaction_trigger' }`, with the same model, instructions, tools and `prompt_cache_key`, `store: false`, and `max_output_tokens: 20000` (the API's minimum for a trigger);
   - the visitor never waits for it.

   If `waitUntil` can't keep the work alive, the compaction is lost and the next turn tries again. No visitor-facing request ever runs a compaction.
4. **Storage:**
   - The returned compaction item is appended as one `native` item (provider and model family, as for reasoning), with `expect` set to the conversation's version after the turn.
   - On a conflict (the visitor already wrote again), it is dropped.
   - Nothing stored is deleted or rewritten: append-only (ADR-0024) still holds.
5. **The replay window** (ADR-0024's `context`) starts at the latest compaction item of the current model family, else at the `maxItems` cut. A bot moved to another model family replays the full history. History, paging, `delete` and `sweep` ignore compaction items. The store needs to recognise a compaction item without parsing provider JSON, so `native` items carry a small kind tag (`kind: 'compaction'`, and `context()` takes the model; see Implementation).
6. **Budgets and usage:**
   - The compaction request reserves an estimate (about 2,000 output tokens plus the cached window), never the 20,000 `max_output_tokens`, and settles its real usage against the same budgets as the turn.
   - The turn's `onUsage` report gains an optional compaction entry with that usage and duration, kept apart from the turn's own `usage`, so dashboards can tell them apart.
   - `usage` reports the compaction as output tokens (S9: 862–1,606 per trigger), and nothing needs correcting.
7. **Guard:** each compaction leaves a slightly larger floor, about 1.2k tokens more each time on luna. If the first step after a compaction is already above `compactAt / 2`, that conversation stops compacting. (A stored note records it; see Implementation.)
8. **Other providers** (0.9, ADR-0026) have no trigger. The fallback is decided with the provider path, not now. S9's evidence, in order of preference:
   - replay search results older than the last two turns as `{ id, title, section }` stubs: no model call, 80.6k became 12.8k, recall and citations intact;
   - a summary by a small model (0.002 USD), replayed as untrusted text (ADR-0019) or in the assistant role, never as a `developer` message.

## Implementation (2026-11-24)

How task 4 built the decisions, and where it had to choose:

- **Decision 3:** `ModelGateway.compact()` (internal) runs in `streamTurn`'s `waitUntil` chain, after `finish` and after the conversation's lock is released, before the `onUsage` report; `onTranscript` doesn't wait for it. It is due when the last model call of a turn that returned had `usage.input_tokens ≥ compactAt` and the gateway reported the conversation's version after its last append, which only an item store does. With output checks, the version after the verdict's note counts. The request sends the turn's `tools` with `tool_choice: 'auto'` and `parallel_tool_calls: true`, a 60 s timeout and no retries; the whole compaction is bounded at 90 s.
- **Decision 4:** before the request, the conversation's version must still be the turn's. If anything was written since, no request is made (`conflict`). The append then expects that version, so a visitor who writes during the request drops it (`conflict`, with its usage charged). One race remains: a compaction appended between a new turn's `context()` and that turn's first append makes the turn answer "busy" (`rate_limited`, retry after 5 s). It needs a visitor to send within milliseconds of the end of a 2–15 s compaction.
- **Decision 5, amended:** the tag is `kind?: 'compaction'` on `native` items, and `context()` takes `model: { provider, family }` (public type `CompactionModel`). The window starts at the later of the latest matching compaction item and the `maxItems` cut. The turn cuts it again, for a custom store that ignores `model`. The Postgres store finds the item in SQL (`item->>'kind'`, `provider`, `family`) without a migration, since items are `jsonb`.
- **Decision 6:** `TurnReservation.compaction(window)` reserves `ceil(window / 10) + 2,000` budget tokens, the window counted as cached input (it reads the cache the turn just wrote). A budget that can't hold it skips the compaction (`skipped`). Without a result (an error), the estimate stays charged. `ChatUsageReport.compaction` is `{ outcome, usage, durationMs }`, with `outcome` one of `compacted`, `conflict`, `skipped` or `failed`.
- **Decision 7, amended:** the floor is the first model call after a compaction, which only that turn knows: its window holds the compaction item and no visitor message after it. A stateless replay has nowhere else to keep the verdict, so that turn appends a `native` note of provider `askdare` (`{ compaction: 'stopped', inputTokens, compactAt }`, token counts only) with its first step. No model is sent it, history doesn't show it, and a compaction finds it in the window and makes no request (`skipped`). The note stays for the conversation: raising `compactAt` later doesn't restart compaction.
- **Startup:** `createChatHandler` warns once per bot that sets `compactAt` with a store whose provider keeps the items (`openaiConversations()`).

## Evidence

- Unit tests: the window per family and with `maxItems`, in the contract suite (memory and Postgres stores); the request's fields against the turn's; conflicts before and during the request; a response without a compaction item; the floor guard; the budget estimate and its settlement; the report; nothing without `compactAt` or with a provider store.
- A `compaction_trigger` response recorded from `gpt-6.1-terra` (`src/openai/testing/fixtures/compaction-trigger.json`, encrypted content and IDs redacted), stored and replayed in a turn test.
- The live smoke test (`gateway.smoke.ts`, "compacts a long stateless conversation…"), run on 2026-11-24 on `gpt-6.1-terra` with `compactAt: 20_000`: a first turn of 22,235 input tokens (a pasted document) compacted once in the background in 2.0 s, reading 22,232 of 22,270 input tokens from the cache, with 66–69 output tokens. The next turn's input was 99 tokens, and it still answered the visitor's name and the fact from the document. The API still refused nothing at `max_output_tokens: 20000`.

## Consequences

- Long conversations on an own store cost a quarter to a half less, and use three to four times fewer budget tokens. Requests shrink from 400–800 KB to a few KB.
- **The per-token savings are modest.** That is why the option is opt-in, and `compactAt` is documented with its trade-off: one extra request per compaction (14–16 s in the background, about 0.01 USD on terra at 80k) against cheaper turns afterwards.
- After a compaction the model no longer has the full text of earlier search results. On these probes it recalled and cited them correctly. With server-side compaction it searched again (one extra step), which the after-turn trigger avoided.
- **The summary quality is OpenAI's.** The compaction item is opaque and encrypted (ZDR-friendly with `store: false`), so askdare can't inspect or test it beyond recall checks. The docs say so.
- A platform without `waitUntil` support never compacts. Turns stay correct, only not cheaper.
- **The budgets problem stays.** Budgets that charge cached tokens at full weight still cut off long conversations early, on every store. Compaction only softens that.

## Public surface

For ADR-0006 (task z1): `limits.compactAt` in `defineBot`; `ChatCompactionReport` and `ChatUsageReport.compaction` in `@boldare/askdare/next`; on the `ConversationStore` port, `kind` on `native` items, the `model` option of `context()` and the `CompactionModel` type; the contract suite's three compaction tests.

## Alternatives considered

- **Server-side `context_management` inside the turn:** simplest (one parameter and the window rule), cache-friendly, and S5's compaction-only retry never triggered. But compacting turns started 3–9 s later before the first token, and the model searched again for passages it had already cited.
- **`/responses/compact`** after the turn: no `tools` field, so it misses the turn's cache. On terra that is 10 times the cost of the trigger. The API accepts an undocumented `tools` field that fixes this, but we don't build on undocumented behaviour.
- **Compaction on by default:** the gain is modest and the summary opaque. An opt-in until real conversations show where the threshold should sit.
- **Compaction with `openaiConversations()`:** S5 and S5b ruled it out (the retained ~64k window, the lost cache, missing `file_search` citations). Nothing in S9 changes that.
- **Only our own summary, for every provider:** provider-neutral and the cheapest per compaction. But it is a plain-text copy of untrusted content that needs its own injection handling, and the trigger is documented and cheap on the path every bot uses today.
- **Deleting old items instead of a window:** breaks append-only, history and audits (ADR-0024).
