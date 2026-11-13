# Spike S5b: server-side compaction at a realistic threshold

- **Date:** 2026-11-12
- **Issue:** boldare/askdare#51 (blocks #52, `limits.compactAt`)
- **Models:** `gpt-6-luna` (the cheapest model in the price list; the docs list no per-model compaction support, and it accepted `context_management`) and `gpt-6.1-terra` (what the starter and site use). Both are named only in this spike.
- **SDK:** `openai` 7.52.0
- **Run:** `pnpm install --ignore-workspace && pnpm start` runs `s5b.ts`. The follow-up probes run the same way with `node --env-file-if-exists=../../examples/starter/.env.local --env-file-if-exists=../../.env.smoke.local <probe>.ts`.
- **Request shape:** mirrors `packages/askdare/src/openai/turn.ts`: `conversation`, `store: true`, `stream: true`, `truncation: 'auto'`, `max_output_tokens`, `safety_identifier`, `prompt_cache_key`, a function tool plus `file_search` with `include: ['file_search_call.results']`, and `context_management: [{ type: 'compaction', compact_threshold }]`. Each visitor turn runs like `runTurn()`: steps until the model stops calling tools, with every function call answered.
- **Cost:** about **1.02 USD** in total, computed from `usage` (cached, cache-write and uncached input priced separately, plus 8 `file_search` calls). The main run was 0.72 USD (0.53 USD of it `gpt-6.1-terra`), and the probes were 0.30 USD. Billing was not compared with the dashboard; see "Usage" below. Every conversation, vector store and file was deleted (main run: 6 of 6; each probe deletes its own conversation and reports it).

## Verdict: no-go for 0.3.0-rc.1. Compaction waits (0.4 at the earliest, opt-in only)

At the 50k threshold S5 proposed, compaction is **harmful**: it never shrinks the input, runs on every turn, adds 2–9 s per turn, defeats prompt caching (12–25× the input cost of the same turns without compaction) and drops file citations. Above about 100k it does shrink the input, but then it loses facts on the cheaper model and still drops citations. See the ADR-0003 update for the decision.

## What the API does with `conversation`

**Compaction keeps the most recent ~60k tokens of history verbatim and summarises only what is older.** The compaction item, counted on its own with the token count endpoint, renders to:

| Threshold | History when it compacted | Message size | Compaction item alone | Next turn's `input_tokens` |
|---|---|---|---|---|
| 50,000 (luna) | 54,332 | ~10.9k | **54,270** (everything) | 54,430 |
| 100,000 (luna) | 101,698 | ~8.5k | **59,266** (last 7 messages) | 59,290 |
| 100,000 (luna) | 103,547 | ~34.5k | **34,557** (last message) | 34,581 |
| 100,000 (terra) | 106,733 | ~35.5k | **35,681** (last message) | 35,705 |
| 200,000 (luna) | 206,924 | ~34.5k | **34,549** (last message) | 34,573 |

The retained window holds whole items and lies between 59.3k and 67.7k tokens (7 messages of 8.5k fit, 8 don't), so probably 64k. Consequences:

- **Below ~64k nothing can shrink.** At 50k the compacted state is as large as the history, so the conversation stays above the threshold and every later response compacts again (main run: 11–12 compacting responses per luna conversation, 8 for terra; input 50.0k → 50.9k → 63.2k, never down). This is also why S5 saw no saving at 1–2k.
- **Above it, compaction works with `conversation`.** At 100k the next turn's input fell from 101.7–106.7k to 34.6–59.3k, the prompt cache missed once (cached 0) and then caught up again on the turn after. For chat-sized messages the floor after compaction is close to 60k, so a threshold `T` saves about `T − 60k` tokens per turn and compacts once per `T − 60k` new tokens.

## Measurements

### Main run (`s5b.ts`, threshold 50,000, `results.json`)

Four conversations, the same script each: facts and a function call (turn 1), a `file_search` question (turn 2), ~12k-token batches of fixture text until the threshold is crossed (the crossing turn also calls the tool), then recall questions, a second `file_search` question and three small turns. The two luna compaction runs then add more text until a second compaction.

| | luna, 16k cap | luna, 1,024 cap | luna, no compaction (control) | terra, 1,024 cap |
|---|---|---|---|---|
| Compacting responses | 11 | 12 | 0 | 8 |
| `incomplete` responses | 0 | 0 | 0 | 0 |
| Compaction-only responses | 0 | 0 | — | 0 |
| Output tokens of compacting responses | 15–256 | 31–185 | — | 41–**765** |
| Compaction pass (item added → done) | 1.8–3.0 s | 1.1–4.8 s, one of **112.9 s** | — | 3.0–**9.4 s** |
| Response time after crossing | 4.9–11.3 s | 4.6–14.7 s (one 117.8 s) | 3.6–5.0 s | 8.6–14.7 s |
| Cached input on the 7 turns after crossing | 50k of 352k | **0** of 352k | 353k of 354k | **0** of 355k |
| Cost of the 7 turns after crossing | 0.045 USD | 0.044 USD | **0.004 USD** | **0.456 USD** |
| File citation on `file_search` before / after | 1 / **0** | 1 / **0** | 1 / 1 | 1 / **0** |

- **Input does not shrink** (see above), and **compaction runs on every response** once the threshold is crossed. Most passes come after the answer (the answer streams first, `response.completed` arrives seconds later), but in `file_search` turns and at 63k they also come before the answer: time to first token rose to 6.3–9.6 s, against 3.0 s in the control.
- **Prompt caching is lost.** Every compaction rewrites the context, so the next turn starts with 0 cached tokens. Without compaction the control replayed ~50k tokens per turn almost fully cached. With compaction the same seven turns cost 12× more on luna and about 24× more on terra (estimated from terra's cached price, as no terra control was run; its cache writes cost 25× its cached input). At 50k compaction raises the bill; it doesn't lower it.
- **`incomplete` and headroom:** none of the 31 compacting responses ended `incomplete`, and none held only a compaction item, unlike S5 (3 of 11). But terra spent **up to 765 output tokens** (≈ 700 of them reasoning) on a compacting turn whose visible answer was a few words, so the default `maxOutputTokens` of 1,024 had only ~260 tokens to spare. Once, a luna response held a compaction item and a function call but no answer; the loop handled it as a normal tool step. The retry for compaction-only responses (`retryCompactionOnly`) never triggered.
- **Usage:** compaction shows up as **output (reasoning) tokens** of the response that ran it; `input_tokens` is the full rendered history. No response reported zero usage this time. `response.compaction.compacting` was never sent (0 of 31). Billing against the dashboard was not checked: the key has no access to the Usage API. The totals in `results.json` (`tokens`) are what the project's usage page for 2026-11-12 should show for this run.
- **Citations:** confirmed. With compaction, the `file_search` answer after the threshold was correct and the search results were included, but it had **no `file_citation` annotation in 3 of 3 conversations** (`fixtures/terra-1024-r4-kb-after-step1.sse`: `"annotations":[]`, with the trailing spaces where the marker was). Before the threshold the same conversations cited (3 of 3), and the control cited both times. The `file_search` responses after the threshold all compacted before the answer.
- **Facts at 50k** (nothing was dropped, so this only shows what compaction does to what it keeps): the name was recalled in 3 of 3 checks and the code word in 5 of 5, including after the second compaction. The Warsaw station code from the turn-1 tool output: terra recalled it; luna answered it in 2 of 4 checks, both times by calling the tool again, and said it was unavailable in the other 2, while the luna control recalled it from the conversation. The gate-code check is void on luna: it refused to share an access code, with or without compaction; terra answered `7319`.

### Above the retained window (`probe-scale.ts`, `results-scale-*.json`)

| Model, threshold, message size | Name after compaction | Code word after compaction |
|---|---|---|
| terra, 100k, ~35.5k | yes | yes |
| luna, 100k, ~34.5k | **no** | yes |
| luna, 100k, ~8.5k | **no** | **no** |
| luna, 200k, ~34.5k | **no** | **no** |

The facts were in the first message, so they had to survive in the summary part of the compaction item. Luna's summary dropped them in 3 of 3 runs; terra kept them in 1 of 1. A compaction pass at 100–200k took 79–162 output tokens and 5.3–6.6 s in total turn time.

### Side findings

- **`responses.inputTokens.count({ conversation })` locks the conversation.** Every `responses.create` on it afterwards failed with 400 `conversation_locked` ("Another process is currently operating on this conversation") for at least 75 s, and so did further counts (`probe-lock.ts`). The first main run lost all its turns to this (0 tokens spent). The library doesn't call this endpoint; it must never count tokens against a live conversation. A stateless count (items passed as `input`) locks nothing.
- `gpt-6-luna` is now allowed in the test project (`probe.ts`); S5 found only `gpt-6.1-terra`.

## What #52 would need, if compaction comes back

1. **Threshold:** at least 100,000 and below 272,000 (the long-context price step). Values under ~80k compact on every turn. Validate this in `defineBot`; no default (off unless set).
2. **`max_output_tokens` headroom:** reserve +1,024 on top of `maxOutputTokens` on requests that may compact (terra used 765 on one), and include it in the budget reservation in `src/limits/limits.ts`.
3. **Usage:** take compaction cost from `usage.output_tokens` as reported; no correction needed in this run, but the S5 zero-usage response means `onUsage` consumers should not assume `output_tokens` relates to the visible answer.
4. **Turn loop:** keep the S5 rule (retry a step that holds only a compaction item), and treat a compaction plus function call as a normal tool step.
5. **Citations:** blocked until `file_search` keeps annotations after compaction, or the stream mapper rebuilds citations from `file_search_call.results`.
6. **Model:** document that the summary quality depends on the model; the cheapest model lost first-turn facts every time.

## Files

- `s5b.ts`: the main run. `results.json` is its raw output; `fixtures/` keeps four redacted compacting responses (encrypted blobs and ids replaced): the terra crossing turn, the terra `file_search` turn without citations, and luna's compaction + function call step and the following 117.8 s step.
- `probe.ts`: which models the project allows, and whether they accept `context_management`.
- `probe-lock.ts`: the conversation lock after a token count.
- `probe-stateless.ts`, `results-stateless.json`: how many tokens the compaction item renders to at 50k.
- `probe-scale.ts`, `results-scale-luna.json` (100k and 200k), `results-scale-luna-8k.json`, `results-scale-terra.json`: compaction above the retained window.

## Sources

- Compaction guide: https://developers.openai.com/api/docs/guides/compaction (server-side compaction; still describes only stateless chaining and `previous_response_id`, not `conversation`).
- Conversation state, compaction section: https://developers.openai.com/api/docs/guides/conversation-state#compaction
- Token counting: https://developers.openai.com/api/docs/guides/token-counting (accepts `conversation`; says nothing about locking).
- Pricing (Standard, short context; cache writes at 30-minute retention): https://developers.openai.com/api/docs/pricing
- Models: https://developers.openai.com/api/docs/models/gpt-6-luna, https://developers.openai.com/api/docs/models/gpt-6.1-terra
- SDK types in `openai` 7.52.0: `ResponseCreateParams.ContextManagement` ("Currently only 'compaction' is supported"), `ResponseCompactionItem`, `InputTokens.count`.
