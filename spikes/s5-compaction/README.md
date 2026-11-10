# Spike S5: server-side compaction with the Conversations API

- **Date:** 2026-11-09
- **Model:** `gpt-6.1-terra` (the only model the test project allows)
- **SDK:** `openai` 7.52.0
- **Run:** `pnpm install --ignore-workspace && pnpm start` in this folder. Raw output is in `results.json`; recorded streams and `items.list` responses are in `fixtures/` (ids replaced, encrypted blobs removed).
- **Request shape:** mirrors `packages/askdare/src/openai/turn.ts`: `conversation: conv_…`, `store: true`, `stream: true`, `truncation: 'auto'`, `max_output_tokens`, `safety_identifier`, `prompt_cache_key`, plus `context_management: [{ type: 'compaction', compact_threshold }]`. `max_output_tokens` was 400; the 0.1 default is 1,024.
- **Cost:** run 2 used 18,633 input tokens (5,529 cached, 10,810 cache writes) and 1,714 output tokens, plus 3 `file_search` calls, so about 0.032 USD. Run 1 used the same experiments with more filler text. Its report was lost (see "Runs"); by the same formula it cost about 0.05 USD, so both runs together stayed under 0.10 USD. Every conversation, vector store and file was deleted: run 2 reported 6 of 6, and a listing afterwards found no vector stores or files left from either run.

## Verdict: no-go for compaction on by default in 0.2, so plan B applies

The API accepts compaction with `conversation`, stores the compaction items, and the model keeps facts across them. Tool calls also continue across a compaction. But three problems make it unsafe as a default without more work:

1. **Compaction counts against `max_output_tokens`.** 3 of 11 compacting responses in run 2 ended `incomplete` with reason `max_output_tokens`. One of them returned only a compaction item: no answer, no tool call, and `usage` of 0 tokens. The visitor would see an empty, cut-off answer.
2. **`usage` under-reports compaction.** The response above reported 0 tokens after about 8 s of work. Another hit the 400-token cap while reporting 118 output tokens. Our budgets (`src/limits/limits.ts`) and `onUsage` rely on `usage`.
3. **No saving could be shown at sizes we can afford to test.** The API's minimum threshold is 1,000 tokens. At 1,000–2,000 tokens the compacted state was about as large as the history it replaced, so the input didn't shrink. Compaction then ran on every turn, usually twice per response, and added 1.2–4.7 s per pass.

There is also one unconfirmed regression: `file_search` answered correctly but produced **no file citations in 3 of 3 turns**, while the same setup without compaction in spike S1 did.

**Plan B (0.2):** keep `truncation: 'auto'` and `limits.maxTurns`, and move compaction to 0.3. Before 0.3, a follow-up spike (S5b) at a realistic threshold, with a budget of a few dollars, should check:
- how many output tokens a 50k-token compaction takes, against the default `maxOutputTokens` of 1,024;
- whether billed tokens match `usage`, using the project's usage page;
- citations with and without compaction, as a controlled comparison.

If compaction ships, the turn loop must treat a response that holds only a compaction item as "retry this step", not as the end of the turn.

## Answers

| # | Question | Result | Go? |
|---|---|---|---|
| 1 | Does `context_management` work on `responses.create` with `conversation`, `store: true`, `stream: true` and `truncation: 'auto'`? | **Yes.** Every request with a threshold of at least 1,000 was accepted in both runs; `truncation: 'auto'` doesn't conflict. The minimum `compact_threshold` is **1,000**: lower values give 400 `integer_below_min_value` with `param: context_management[0].compact_threshold`. The response object doesn't echo `context_management` (it is `null` in `response.created`). | Go |
| 2 | Is the `compaction` item stored, and does `conversations.items.list` return it? | **Yes.** Items of `type: 'compaction'` (`id: cmp_…`, `encrypted_content` of 4–6k characters, no `created_by`) are stored in the conversation next to the messages. **All earlier messages stay listed**, so history on reload still shows them, and our history mapper already skips the new type (recorded test added). Compaction items take slots in the 100-item history page: after 6 exchanges at a 1,300-token threshold, the conversation held 12 messages and 8 compaction items. | Go |
| 3 | Does `usage.input_tokens` drop on the turn after compaction? | **Not shown.** Plain chat at a 1,300-token threshold: 542 → 1,068 → 1,714 (this turn compacted) → 1,755 → 1,779 → 1,802. The turns after compaction were small, so these numbers can't separate "compacted state" from "full history". One drop was measured in the tool loop: 1,445 → 1,313 tokens, although a function call and its output were added. The compacted state still held details: the model recalled the code word from turn 1 and the exact line "Ghent ships 17 clay tiles" from note 1.1. Compaction itself is billed as **output/reasoning tokens**: a turn that answered "noted" reported 219 output tokens (213 reasoning) instead of 6. | Open |
| 4 | Which stream events arrive? | Only `response.output_item.added` / `.done` with `item.type: 'compaction'`. **No `response.compaction.compacting`** in any run; the reference says it is sent at most every 30 s and may be skipped for short compactions. Compaction items appear **before the answer** (it starts later: time to first token 2.7–3.7 s instead of 1.2–1.8 s), **after the answer** (that compaction takes another 1.2–4.7 s before `response.completed`), and, in tool and `file_search` loops, **between reasoning items**. One `file_search` response held 4 compaction items. Our stream mapper ignores them today (recorded test added); plan step 3 would show them as the existing "thinking…" state. | Go, with the latency noted |
| 5 | Does it still work with a function tool and with `file_search`? | **Function tool: partly.** The step that crossed the threshold returned a compaction item plus `function_call`. The `function_call_output` in the next request was accepted (no "No tool output found" 400), and the answer used it ("Warsaw: 12°C and cloudy."). But that step ended `incomplete` (`max_output_tokens`), and the next turn ("And in Krakow?") returned **only a compaction item**, `incomplete`, with zero usage. **`file_search`: partly.** Searches ran and all 3 answers were correct (Pixel, Wednesday, Fridays), but none had a citation, and turn 2 ended `incomplete` at 118 reported output tokens. Note also that compaction fired at the end of a tool bot's first turn with only 566 input tokens against a 1,000 threshold. The threshold counts more than `usage.input_tokens` reports (tool definitions, reasoning, output). | No-go as a default |
| 6 | Recommended default `limits.compactAt` | **50,000 tokens, once the blockers above are fixed.** It is far above the 1,000 floor and above any compacted state, so compaction would run rarely, not every turn as at 1–2k. It is well below the smallest context window among models the Responses API still serves (128k for `gpt-4o-mini`; 272k maximum input for `gpt-5.4-mini`; 922k for `gpt-6.1-terra` and `gpt-6-luna`), so it is safe whichever model a bot uses. It also keeps every request under the 272k-token step where long-context pricing doubles input rates. It is a plain token count, so the library still hardcodes no model IDs. Whether a 50k compaction fits under `maxOutputTokens` is exactly what S5b must measure. Not tested here: whether models other than `gpt-6.1-terra` accept `context_management` at all. | — |

## Runs

- **Run 1** used thresholds of 2,000 and 1,600 with about 900 tokens of filler per turn. It showed the same pattern: compaction on the turn that crossed 2,000 input tokens (2,778), two compaction items per response from then on, and correct recall of the code word and of note 1.1. The script's key check then tripped on base64 inside an `encrypted_content` blob and stopped before writing `results.json`. Cleanup had already run, and nothing was left over. The check now runs after blobs are removed.
- **Run 2** (`results.json`, `fixtures/`) is a smaller copy with thresholds of 1,300 and 1,000 and about 500 tokens of filler, to stay within budget.

## Fixtures

- `packages/askdare/src/openai/testing/fixtures/compaction-turn.sse`: a plain turn that compacts (compaction, message, compaction).
- `…/compaction-only.sse`: a response that holds only a compaction item and ends `incomplete` with zero usage.
- `…/compaction-items.json`: `conversations.items.list` (as `listHistory` calls it) right after the compacting turn.
- `fixtures/` here: every recorded turn of run 2 and both `items.list` responses.

`packages/askdare/src/openai/recorded.test.ts` replays the three package fixtures against the current gateway: the answer maps unchanged, a compaction-only response ends as `max_output_tokens` with an empty answer, and history skips compaction items.

## Sources

- Compaction guide: https://developers.openai.com/api/docs/guides/compaction. It covers only stateless input chaining and `previous_response_id`, not `conversation`.
- Conversation state, compaction section: https://developers.openai.com/api/docs/guides/conversation-state#compaction
- Deployment checklist, "Leverage compaction": https://developers.openai.com/api/docs/guides/deployment-checklist#leverage-compaction
- Streaming events (`response.compaction.compacting`; the compaction item lifecycle): https://developers.openai.com/api/reference/resources/responses/streaming-events
- Models (context windows): https://developers.openai.com/api/docs/models/gpt-6.1-terra, https://developers.openai.com/api/docs/models/gpt-6-luna, https://developers.openai.com/api/docs/models/gpt-5.4-mini, https://developers.openai.com/api/docs/models/gpt-4o-mini
- Pricing (cost estimate; the 272k long-context step): https://developers.openai.com/api/docs/pricing
- SDK types in `openai` 7.52.0: `ResponseCreateParams.ContextManagement`, `ResponseCompactionItem`, `ResponseCompactionCompactingEvent`; `ConversationItem` includes `ResponseCompactionItem`.
