# Spike S9: compaction on a store we own

- **Brief:** `tasks/0.6-s9-compaction-own-store.md` (deleted by the branch that finishes it; see git history). Feeds [ADR-0029](../../docs/adr/0029-compaction-for-item-stores.md).
- **Date:** 2026-11-23. **Models:** `gpt-6.1-terra` (what the starter and site use) and `gpt-6-luna` (the cheapest), named only in this spike. SDK `openai` 7.56.0.
- **Setup:** S7's stateless loop (`store: false`, the stored items replayed, one append per step), with ADR-0025's `search_knowledge` tool (strict, up to 5 passages of about 300 tokens, stable `k` + 12-hex IDs, results wrapped as untrusted) and S7's `lookup_order`. `maxSteps` 5, `max_output_tokens` 1,024, `tool_choice: 'none'` on the last step, `prompt_cache_key`, instructions of about 1,800 tokens. The help centre is synthetic: 100 passages with four planted facts (`kb.ts`).
- **Cost:** **0.98 USD**, computed from `usage` (cached, cache-write and uncached input priced separately). Of it, 0.81 USD was `gpt-6.1-terra`. Not compared with the billing dashboard.
- **Cleanup:** nothing was created at OpenAI. Every request sent `store: false`, `/responses/compact` is stateless, and the spike creates no conversations, files or vector stores. The stored histories (with encrypted reasoning and compaction items) stay in the git-ignored `.out/`. The committed `results-*.json` hold usage, timings and short answers of the fictional visitor, with no encrypted content.

## Verdict: **go with conditions**

On a store we own, compaction no longer has the problems S5 and S5b found with `conversation`:
- the input shrinks to a few thousand tokens instead of about 60k;
- the cost hits once per compaction instead of every turn;
- facts and `[id]` citations survive.

It saves money on long conversations: 27–56 % of a 50-turn conversation, and three to four times fewer budget tokens. That is a gain, but a modest one, so it ships as an option, not a default.

**Conditions** (ADR-0029):
1. **Item stores only.** `openaiConversations()` keeps no compaction (S5b stands).
2. **After the turn, off the critical path.** Compact in the handler's `waitUntil` with a `compaction_trigger` request that reuses the turn's model, instructions, tools and cache key. Store the result as a `native` item. A version conflict drops it; the next turn tries again.
3. **Opt-in**, `limits.compactAt`, at least 20,000 tokens, compared with the last step's `usage.input_tokens`.
4. **The replay window starts at the latest compaction item of the current model family.** Nothing stored is deleted or rewritten, so history and paging are unaffected, and a model switch falls back to the full history.
5. **The compaction request is charged to the budgets and `onUsage` like a step.** Its usage reports the compaction as output tokens.

There is a bigger finding next to compaction: **askdare's token budgets count cached input at full weight.** A realistic 50-turn conversation spends the default `dailyTokensPerIp` (200,000) by turn 13, and the bot's whole `dailyTokens` (2,000,000) by turn 37, while costing 0.31 USD. Compaction only softens this. Weighting cached tokens in the budgets fixes it for every store, the OpenAI default included. It is a separate task; see "For the parent session".

## Answers

### 1. Is it needed? (`growth.ts`, `results-growth-*.json`)

The 50 messages of `script.ts` (`limits.maxTurns` = 50) were run as one conversation: a visitor asking about policies, two orders and follow-ups. It is long but realistic: 43 searches and 5 order lookups on terra, 57 searches on luna, in 96–100 model calls.

| | `gpt-6.1-terra` | `gpt-6-luna` |
|---|---|---|
| Input of the first step at turn 10 / 20 / 30 / 40 / 50 | 12.6k / 28.8k / 45.8k / 63.7k / **80.7k** | 15.1k / 33.2k / 55.8k / 86.6k / **113.4k** |
| Stored items at turn 50 | 201 (416 KB) | 317 (798 KB) |
| Share of the window that is search results | 84 % (80.6k → 12.8k without them) | 80 % (113.4k → 22.2k) |
| Cached input over the conversation | 97.9 % | 97.9 % |
| Cost of the conversation | **0.306 USD** | 0.071 USD |
| Cost of turns 1–10 / 41–50 | 0.028 / **0.083 USD** | 0.004 / 0.023 USD |
| Time to the first token on a turn without a search, median of turns 1–10 / 41–50 | 1.0 / 1.3 s | 1.8 / 2.4 s |
| Whole turn, median of turns 1–10 / 41–50 | 2.6 / 3.7 s | 4.0 / 4.8 s |
| Tokens charged to the budgets (`limits.ts`: input + output, cached included) | **3.82M** | 5.26M |
| Turn at which `dailyTokensPerIp` (200k) runs out | **13** | 12 |
| Turn at which the bot's `dailyTokens` (2M) runs out | **37** | 33 |

- **The context window is never the problem:** 81–113k tokens against the 922k window of both models, below the 272k long-context price step.
- **Latency hardly grows:** with 98 % of the input cached, an 80k prefix adds about 0.3 s to the first token. Search turns are slower because they take two steps, not because of size.
- **Cost grows linearly per turn,** so it grows quadratically per conversation: a turn at 80k costs three times a turn at 10k. Search results are most of it. Each search adds about 1.8k tokens that are replayed on every later step.
- **Budgets are where it hurts:** `limits.ts` charges `inputTokens + outputTokens`, and cached tokens are part of `inputTokens`. At 0.31 USD, one visitor spends the default per-IP budget by turn 13 and the bot's daily budget by turn 37. Sites hit `budget_exceeded` long before cost or latency matter.
- **Attachments, not measured:** a message can carry up to 3 PDFs of up to 50 pages (`attachments` defaults). OpenAI puts a PDF's text and an image of every page into the context, so one large PDF could add more than a whole 50-turn conversation of searches, and it is replayed on every later step like a search result.

So yes, it is needed, for cost and budgets, not for the context window or latency. The answer is not "no-go at question 1", so questions 2–6 were run.

### 2. Server-side compaction, stateless (`arms.ts` `server`, `growth.ts` with `S9_THRESHOLD`)

`context_management: [{ type: 'compaction', compact_threshold }]` with `store: false`. The compaction item comes back in `response.output`. It is stored as a `native` item (`kind: 'compaction'`), and the next replay starts at it, as the compaction guide says for stateless chaining ("drop items that came before the most recent compaction item").

| | terra, 80.6k history, threshold 70k | luna, 113.4k history, threshold 100k |
|---|---|---|
| Where the compaction item came | before the answer (`compaction, message`) | before the answer |
| Cached input of the compacting step | 80,703 of 80,857 | 113,485 of 113,667 |
| Output tokens of the compacting step | 168 (normal: 20–40) | 197 |
| Time to the first token of the compacting step | **4.4 s** (control: 1.3 s) | **4.2 s** (control: 1.2 s) |
| Input of the next turn | **4,465** (cached 0) | **4,494** (cached 0) |
| The turn after that | 4,697, cached 4,606 | 4,696, cached 4,645 |
| The compaction item, rendered with the instructions | 4.3k (about 2.5k without them) | 4.3k |
| Probes correct | 5 of 5 | 5 of 5 |

- **The input shrinks to about 4.5k,** not to the ~60k S5b measured with `conversation`. With `conversation`, OpenAI keeps the recent ~64k verbatim. Stateless, the item covers everything before it, and the replay drops those items.
- **The cache survives:** the compacting step reads the whole prefix from the cache. Only the first step after it misses, and that is a 4.5k prefix. The cost hits once per compaction.
- **It costs latency on that one turn:** both passes ran before the answer and added about 3 s before the first token. In the 20k saw-tooth below, the first token on compacting turns came after 4.1–8.7 s, against 2–3 s on other turns.

**Saw-tooth, 50 turns on luna at a 20,000 threshold** (`results-growth-gpt-6-luna-t20000.json`):
- **5 compactions,** at turns 15, 25, 32, 38 and 44. The window fell from 18–22k to 6.2k, 6.3k, 7.7k, 9.4k and 11.2k.
- **Each compaction leaves a larger floor** (about +1.2k each): the new item summarises the old one plus what came after it. So the turns between compactions get shorter (10, 7, 6, 6 turns). A low threshold in a very long conversation would end up compacting every turn, so the library needs a guard (ADR-0029).
- **Cost:** 0.031 USD instead of 0.071 USD (−56 %), with 90.4 % cached instead of 97.9 %. Tokens charged to the budgets: 1.26M instead of 5.26M (−76 %).
- **Reliability:** no `incomplete` response, no compaction-only response (S5's retry never triggered), and at most 746 output tokens in a compacting step.
- **Facts after 5 compactions,** on the cheapest model: name, postcode, floor, the order's carrier and tracking code, and both cited facts from turns 2–6 were all recalled (5 of 5 probes). S5b's luna lost first-turn facts in 3 of 3 runs with `conversation`.

**Terra, the same comparison estimated** from its measured 50-turn steps, with the measured reset (4.5k, +1.2k per compaction) and terra prices. The model reproduces the measured run without compaction (0.307 vs 0.306 USD):

| Threshold | Compactions | Cost of 50 turns | Budget tokens |
|---|---|---|---|
| none | 0 | 0.307 USD | 3.82M |
| 60,000 | 1 | 0.246 USD (−20 %) | 2.48M |
| 40,000 | 2 | 0.228 USD (−26 %) | 1.97M |
| 20,000 | 5 | 0.223 USD (−27 %) | 1.22M (−68 %) |

Terra saves less than luna because its cache writes cost 25 times its cached reads (luna: 12.5 times), so the miss after each compaction weighs more.

### 3. The compact endpoint, off the critical path (`arms.ts` `endpoint`, `probe-compact-cache.ts`, `probe-trigger.ts`)

**`/responses/compact`** (`responses.compact({ model, instructions, input, prompt_cache_key })`), called after the turn had ended:

| | terra, 80.6–82.4k | luna, 113.4–115.3k |
|---|---|---|
| Latency | 13.8–16.4 s | 11.6–14.0 s |
| Output | all 50 visitor messages verbatim, then one compaction item | the same |
| Window after it, with the instructions | 3.3k | 3.8k |
| Output tokens (all reported in `usage`) | 698–815 | 1,153–1,455 |
| Cached input, called right after a turn | **0** | **0** |
| The same call repeated | 82,389 cached | 115,201 cached |
| The same call, with the bot's `tools` added | — | **115,231 cached, 4.0 s, 238 output tokens** |
| Cost per compaction, uncached / cached | **0.086** / 0.008 USD | 0.012 / 0.001–0.002 USD |

- **It doesn't read the turn's cache.** The endpoint has no `tools` field, so its prompt starts differently from the turn's, and the cache misses. The SDK types and the API reference don't list `tools`, but the API accepts it: with the bot's tools the call read the turn's cache. That is undocumented, so we don't rely on it.
- **After it, everything worked:** 5 of 5 probes on both models, both earlier passages cited from memory with IDs that resolve, no new search. The first turn after it misses the cache, on a 3–4k prefix.

**The documented way to compact on request:** `responses.create` with `{ type: 'compaction_trigger' }` as the last input item (compaction guide, "Request compaction with an explicit trigger"). It is a normal create request, with the bot's tools, instructions and cache key:

| | terra, 82.6k | luna, 115.4k |
|---|---|---|
| Cached input | **82,510 of 82,570** | **115,292 of 115,376** |
| Latency | 14.5 s | 15.7 s |
| Output | one compaction item, nothing else | the same |
| Output tokens | 862 | 1,606 |
| Cost | **0.0085 USD** | 0.002 USD |
| Next turn's first step | 2.7k (1,778 cached: instructions and tools) | 3.4k |
| After it | correct; the per-floor charge cited from memory with the right ID; postcode and tracking code recalled | the same |

- **It requires `max_output_tokens` ≥ 20,000.** A lower value gives 400 `'compaction_trigger' requires 'max_output_tokens' to be at least 20000 when specified`. Our rules say always set `max_output_tokens`, so the request sets 20,000, and the budget reservation must not reserve all of it (decision 6 of ADR-0029).
- **Off the critical path, it costs nothing in latency.** The visitor doesn't wait for the 14–16 s, and the next message pays only one small cache miss. The handler already passes `waitUntil` (`after()`) to `streamTurn`. It runs after the conversation's turn lock is released, so the next visitor turn never waits for it. A visitor who writes during those 15 s makes the compaction's append conflict, and it is dropped.

### 4. Our own summary, with a small model (`arms.ts` `summary`)

The older part (everything before the last two visitor turns) is rendered as plain text: messages, tool calls and lookup results, and search results as their IDs and titles only. `gpt-6-luna` summarises it with instructions to keep the visitor's facts, the tool results and every answer with its `[id]`. The summary is stored as a neutral `summary` item and replayed as one message before the verbatim tail. It needs no provider feature, so it works on S6a's and S6b's paths.

| | terra history (80.6k) | luna history (113.4k) |
|---|---|---|
| Summary call (luna) | 14.2 s, 7.4k input, 1,581 output (630 reasoning), **0.0017 USD** | 12.0 s, 9.4k input, 1,383 output, 0.0019 USD |
| Summary | 3.9k characters | 3.6k characters |
| Kept (name, postcode, floor, carrier, tracking code, both planted IDs) | 7 of 7 | 7 of 7 |
| IDs in the summary that resolve | 11 of 11 | 15 of 15 |
| Window after it, with the instructions | 2.8k | 2.8k |
| Probes correct / planted passage cited | 5 of 5 / 2 of 2 | 5 of 5 / 2 of 2 |

- **It is the cheapest and smallest.** The quality matched the encrypted compaction on these probes, which test facts and citations, not nuance.
- **It is plain text derived from the conversation:** readable, debuggable and deleted with the conversation. That makes it a copy of visitor data and of untrusted document text. Here it went in as a `developer` message, a more trusted role than the visitor's own text or tool output, which ADR-0019 doesn't allow. A shipped version must replay it as an untrusted block (ADR-0019's wrapper) or in the assistant role.
- **A cheaper variant with no model call** (`arms.ts` `elide`): search results older than the last two turns are replayed as `{ id, title, section }` stubs. Terra's window went from 80.6k to 12.8k, luna's from 113.4k to 22.2k. 5 of 5 probes stayed correct, and both earlier passages were cited from the model's own earlier answers. It costs nothing to produce, and it is deterministic and works with every provider. The window still grows with the conversation (about 250 tokens a turn), so it is a complement, not a replacement.

### 5. Citations after compaction (every arm)

Probes `cited-earlier` and `cited-earlier-2` ask for facts from passages found at turns 2–6 ("cite the source you used earlier"). Both planted passages had been found and cited before the compaction point in both histories.

| Arm | Correct, with the planted passage cited | IDs that don't resolve | Searched again |
|---|---|---|---|
| control (no compaction) | 4 of 4 (2 models × 2 probes) | 0 | 0 |
| server-side compaction | 4 of 4 | 0 | **4 of 4** |
| `/responses/compact` | 4 of 4 | 0 | 0 |
| `compaction_trigger` (one probe each) | 2 of 2 | 0 | 0 |
| own summary | 4 of 4 | 0 | 0 |
| elide | 4 of 4 | 0 | 0 |
| 5 server-side compactions (luna, 20k) | 2 of 2 | 0 | 1 of 2 |

- **Citations survive, and every ID resolves.** That is ADR-0025's stable source IDs at work: an ID from turn 3 still resolves at turn 55 through `passage()`. A per-turn registry would have mapped them wrongly after compaction.
- **After server-side compaction, the model searched again** for both earlier passages, on both models, and then cited the fresh result. The answers were right, at the cost of one extra step each. After an after-turn compaction (endpoint or trigger), it cited from memory.
- **No `file_citation` regression applies:** S5b's missing citations came from `file_search` annotations, which compaction drops. ADR-0025's markers are plain text in the answer and survive like any other text.

### 6. Budget and usage

| Way | Output tokens per compaction | Reported in `usage`? |
|---|---|---|
| Server-side, inside a step | 168–746 (step total; normal steps 15–300) | yes, as `output_tokens` of that step (reasoning 0) |
| `/responses/compact` | 238–1,455 | yes, in the endpoint's `usage` |
| `compaction_trigger` | 862–1,606 | yes, as `output_tokens` |
| Own summary (luna) | 1,383–1,581 (516–630 reasoning) | yes |

- **Every way reports its tokens, and none had zero usage.** S5's zero-usage response did not recur (0 of 16 compactions).
- **The +1,024 headroom S5b asked for covers server-side compaction:** at most 746 output tokens here.
- **Two budget rules for ADR-0029:** a `compaction_trigger` request must set `max_output_tokens` ≥ 20,000, so the reservation uses an estimate (about 2,000 tokens) and settles the actual usage afterwards. Compaction requests count against the same budgets and `onUsage` as turns.

## ADR input

**Decision for ADR-0029:**
1. **Scope:** item stores only (ADR-0024). The OpenAI Conversations default gets no compaction: S5 and S5b stand.
2. **Option:** `limits.compactAt` (tokens), off by default. Validated between 20,000 and 272,000. It is compared with the last step's `usage.input_tokens` of the turn, so no token count is needed (and none against a conversation, which S5b found locks it).
3. **Mechanism on the OpenAI path:** after a turn whose last step reached `compactAt`, and after the conversation's turn lock is released, run one `responses.create` with:
   - the replayed window and `{ type: 'compaction_trigger' }`;
   - the same model, instructions, tools and `prompt_cache_key`;
   - `store: false`, `max_output_tokens: 20000`.

   It runs in `waitUntil`. The visitor never waits for it.
4. **Storage:** the compaction item is a `native` item (provider `openai`, the model family). It is appended with `expect` = the version after the turn, and a conflict drops it. Nothing is deleted or rewritten.
5. **Replay window:** `context()` starts at the latest compaction item of the current model family. A model switch to another family ignores it and replays everything (or the `maxItems` window). History, paging, deletion and sweep ignore compaction items.
6. **Budgets:** the compaction request reserves an estimate and settles its real usage against the same budgets. It is reported to `onUsage` as its own entry (`kind: 'compaction'`).
7. **Guard against a rising floor:** when the first step after a compaction is already above `compactAt / 2`, the conversation stops compacting.
8. **Not chosen:**
   - server-side `context_management` inside the turn: 3–9 s before the first token on compacting turns, and the model searches again for passages it had;
   - `/responses/compact`: it doesn't read the turn's cache (0.086 instead of 0.008 USD on terra) without an undocumented `tools` field;
   - our own summary and elided search results: left for the provider path (0.9), where the OpenAI trigger doesn't exist. Elision first, since it needs no model call.

**ADR-0024 changes:** decision 3's `maxItems` window gains a second cut point, the latest compaction item, which ADR-0024 already expected ("what compaction (spike S9) … builds on"). `native` items get a `kind` (or equivalent) so the window can find compaction items without parsing provider JSON.

**For ADR-0003:** the S5b decision ("compaction waits") stays true for `openaiConversations()`. ADR-0029 extends it to item stores only. The implementing task sets ADR-0003's status line.

## For the parent session

- **Budget weighting (outside this spike, more urgent than compaction):**
  - `limits.ts` charges cached input tokens at full weight, so the defaults cut off long conversations early: `dailyTokensPerIp` at turn 12–13, and one conversation spends the bot's whole `dailyTokens` by turn 33–37.
  - This happens today with the OpenAI default too, since conversation mode reports the same `input_tokens`.
  - Suggested fix: charge cached tokens at a fraction, for example 1/10, or budget in cost units. That changes what `dailyTokens` means, so it needs a changeset and docs, maybe an ADR line.
  - It deserves its own task (Hygiene lane, can run beside 0.6).
- **Undocumented `tools` on `/responses/compact`:** accepted, and it makes the call read the turn's cache. Not used, but worth asking OpenAI about if the trigger ever goes away.
- **`compaction_trigger` needs `max_output_tokens` ≥ 20,000.** Not in the guide (checked 2026-11-23).

## Files

- `kb.ts`: the synthetic help centre, search, the untrusted wrapper and the citation check.
- `items.ts`: stored items (S7's kinds plus `summary`, and `native` with a `kind`), the deterministic mapping and the replay window.
- `turn.ts`: the stateless turn loop (from S7), tools, prices and the spend guard.
- `script.ts`: the 50 visitor messages and the probes.
- `growth.ts`: question 1 (`results-growth-<model>.json`), and with `S9_THRESHOLD` the server-side saw-tooth (`results-growth-gpt-6-luna-t20000.json`).
- `arms.ts`: questions 2–5 from one history: `control`, `server`, `endpoint`, `summary`, `elide` (`results-arms-*.json`).
- `probe-compact-cache.ts`: whether `/responses/compact` reads the turn's cache (`results-compact-cache-*.json`).
- `probe-trigger.ts`: `compaction_trigger` after a turn (`results-trigger-*.json`).

Run: `pnpm install --ignore-workspace`, then `node --env-file=<path to a .env with OPENAI_API_KEY> growth.ts gpt-6.1-terra`, then `arms.ts gpt-6.1-terra history-gpt-6.1-terra.json 70000`. Each script stops at `S9_BUDGET_USD`.

## Sources

- Compaction guide (server-side compaction with `store: false`, the explicit trigger, the standalone endpoint): https://developers.openai.com/api/docs/guides/compaction
- `/responses/compact` (OpenAPI spec, `CompactResource`): https://developers.openai.com/api/reference/resources/responses/methods/compact
- Conversation state, stateless chaining: https://developers.openai.com/api/docs/guides/conversation-state
- Pricing (same per-token prices as S5b and S7): https://developers.openai.com/api/docs/pricing
- SDK types in `openai` 7.56.0 and 7.62.0: `ResponseCompactParams` (no `tools`), `CompactedResponse` ("all user messages, followed by a single compaction item"), the `compaction_trigger` input item.
