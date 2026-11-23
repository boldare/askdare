# Spike S6a: Claude behind `ModelGateway` (turn, tools, caching, errors)

- **Date:** 2026-11-23
- **Model:** `claude-opus-5-5`, effort `low` unless noted, thinking adaptive with `display` omitted (the default). The model ID is named only in this spike.
- **SDK:** `@anthropic-ai/sdk` 1.11.0, which sends API version `2026-10-21`.
- **Run:** in this folder, `pnpm install --ignore-workspace`, put `ANTHROPIC_API_KEY` in `.env`, then `node --env-file=.env s6a.ts [experiment…]`. `claude-turn.ts` is a cut-down Claude version of `packages/askdare/src/openai/turn.ts`. It uses the same Brightloop bot as `site/` (instructions, `get_current_time`, `get_exchange_rate`, `suggest_replies`), a stub retriever over `site/knowledge/`, and a stream mapper to askdare's `ProtocolEvent`s. Raw results are in `results.json`; redacted streams are in `fixtures/` (thinking signatures replaced, nothing secret in them).
- **Cost:** **1.55 USD** in total, computed from `usage` at 4 / 20 USD per 1M input/output tokens, 0.20 cached and 5 for cache writes. The main conversation probe cost 0.25 USD and the message-thread probe 0.46 USD. One accidental degenerate answer cost 0.32 USD (see Q2).
- **Cleanup:** the run uploaded two files to the Anthropic Files API, and both were deleted by the run (`list-files.ts` afterwards: 0 files in the workspace). Message threads (Q3) can't be deleted through the API. They expire 5 minutes after their last request and are deleted within an hour.

## Verdict

**GO for native Claude behind `ModelGateway`, but not as a key swap.** A turn, the tool loop, citations, caching, usage and errors all map onto today's protocol without changing it. Six things have to change in core or in decisions first:

1. **A conversation store** (S7). The Messages API keeps nothing.
2. **Own retrieval** (S8). The citation side of it works (Q4).
3. **`suggest_replies` must come before the answer on Claude**, which breaks ADR-0015 variant A as written: answer first, then call the tool. On `claude-opus-5-5` text written before a tool call comes back as an empty `thinking` block. Called after the answer, the visitor saw **no answer in 4 of 4 knowledge turns**.
4. **The forced last step needs an operator note** besides `tool_choice: none`. Without the note it failed in 6 of 8 runs.
5. **The store must rewrite file references** when a file is deleted or expires. Otherwise every later turn fails with 404.
6. **Voice is unavailable** on Claude, and so is the moderation endpoint (ADR-0019).

Expect higher cost and slower knowledge answers on Claude:

- **Cost:** about 4× per conversation at list prices (Q5).
- **Speed:** a median of 6.0 s to first visible text on knowledge questions, against 2.7–3.0 s with `file_search`. Most of the gap is the extra `suggest_replies` step.

## Results

### Q1. Turn and stream

Every `ProtocolEvent` the OpenAI mapper emits has a Claude source:

| askdare event | Claude stream event |
|---|---|
| `text.delta` | `content_block_delta` / `text_delta` (also the initial `text` of a `content_block_start`) |
| `reasoning` started / done | `content_block_start` / `content_block_stop` of a `thinking` or `redacted_thinking` block. With `display` omitted the text is empty, so only the status leaves the server, as today. |
| `citation` | `citations_delta` with a `search_result_location` (Q4) |
| function call (server only) | `content_block_start` (`tool_use`, id, name) + `input_json_delta` + `content_block_stop`. Inputs never reach the client. |
| step outcome | `message_start` (model, input usage) and `message_delta` (`stop_reason`, output usage), or `stream.finalMessage()` |
| `tool.status` for knowledge | Emitted by our retriever tool, as a `file_search` status today |

End reasons:

| `stop_reason` | askdare |
|---|---|
| `end_turn` | `completed` |
| `max_tokens` | `max_output_tokens` |
| `refusal` | `content_filter` (`stop_details.category` goes to logs only) |
| `model_context_window_exceeded` | `error.conversationTooLong` |
| `tool_use` | next step |
| `pause_turn` | Only with server tools, which askdare doesn't use |

A refusal can arrive mid-stream, after text has gone to the client. Anthropic says to discard the partial output, and the protocol has no event that takes text back. With server-side `fallbacks` the fallback model continues on the same stream from the partial text, so the client keeps what it has (see Q7).

Time to first text, warm cache, 5 runs each (`ttft`). S1 measured 0.87–1.26 s on OpenAI.

| Variant | Median | Notes |
|---|---|---|
| Minimal (no tools, 251 tokens) | 0.93 s | |
| Full bot, `low` | 0.81 s | The first, cold request took 4.2 s (cache write) |
| Full bot, `medium` (3 runs) | 0.73 s | |

At either effort the model didn't think on a greeting (no `thinking` block, 0 thinking tokens). `answerItemId`: the answering step's `msg_…` ID exists, but with an own store the feedback handle should use the store's ID.

### Q2. Tool loop

- **Strict tools:** the bot's tools are zod schemas, converted with `z.toJSONSchema(…, { target: 'draft-7' })` and sent with `strict: true` and `additionalProperties: false`. They were accepted, including `minLength`/`maxLength` (`strict`). `zodResponsesFunction` has no counterpart and needs none. Tool order is fixed so the cached prefix stays stable.
- **Parallel calls:** the model sent three `tool_use` blocks in one message (two time zones and one exchange rate, `tools`). All three results went back in one user message, the failing one with `is_error: true`. The answer gave both times and said the rate couldn't be checked (`fixtures/tools-parallel.json`). The protocol events matched today's: three `running`, then `error`/`done`, `reasoning`, text.
- **`tool_choice` `any` and `tool`:** both return **400** "tool_choice: type "tool" and "any" are not supported for this model."
- **`tool_choice: none` alone is not reliable.** When the model still wanted a tool, it wrote the call as visible text in 5 of 8 runs, or refused, or thought until `max_tokens`:

  | Case | Runs | Outcome |
  |---|---|---|
  | Forced at step 1 | 6 | 1 answered. 1 wrote tool-call markup (`<invoke name="get_current_time">…`) as text until `max_tokens` = 16,000 tokens, 0.32 USD. 2 stopped with `refusal` (`stop_details` null). 2 hit `max_tokens` at 1,200. |
  | After tool results (the usual last step) | 2 | 1 answered. 1 spent all 1,200 tokens in `thinking`. |
  | **With a mid-conversation `role: "system"` note** ("Tools are unavailable for the rest of this answer. Reply in plain text only…") | **4** | **4 clean answers that said what couldn't be checked.** 2 forced at step 1, 2 after tool results. |

  The cache survived the switch from `auto` to `none` (5,049 of 5,053 tokens read, `finalStep`). The last step should also keep a lower `max_tokens` as a cost guard.
- **`suggest_replies` (ADR-0015).** On `claude-opus-5-5`, text the model writes before a tool call in the same response comes back as a progress-update `thinking` block, which is empty under the default `display`. The current tool description says to answer first and then call the tool. So the answer disappears.

  | Variant | Visible answer | Notes |
  |---|---|---|
  | Answer, then call (today) | **0 of 3** (`replies`), plus knowledge turn 1 | Replies arrived; the next step ended with 2 output tokens, because the model thinks it has answered |
  | `display: "updates"` (beta) | 1 of 3 | Only a *summary* of the answer came back, as a thinking block, without citations |
  | **Call first, then answer** (tool description changed) | **3 of 3** (`replies`) and **4 of 4** (`repliesTiming`), and 20 of 20 conversation turns, with citations | Costs one more model call per turn that offers replies: ~80–90 output tokens and 1.5–2.1 s |

  Time to first visible text with replies first, on knowledge questions: **5.3–8.3 s, median 6.0 s** (search 1.8 s + suggest 1.7 s + answer). On OpenAI, S1 E6 measured 2.7 s and the S5b control 3.0 s. Not tested: replies from a separate small request after the answer, which would keep them off the critical path.

### Q3. Conversation state (in-scope part; S7 owns the store)

What Claude needs from a store each turn: **the whole message array, replayed verbatim and append-only**. That means:

- user messages, with the page-context part and file blocks;
- the `role: "system"` notes (identity, last-step note, and the output-check notes from ADR-0022);
- each assistant `content` array unchanged: `thinking` blocks with their signatures, `text` blocks with `citations`, `tool_use`;
- the `tool_result` messages, including `search_result` blocks.

Editing or dropping earlier blocks breaks the cache and, on this model, the history-editing check of preserved thinking. After 20 turns the array was **114 messages, 79 KB of JSON**, about 26k input tokens (`fixtures/conversation-history.json`). The history a visitor sees on reload is a view derived from it. The store therefore needs a provider-native (or lossless) transcript, not just the visible messages.

**Message threads** (beta `message-threads-2026-08-12`), 62k-token conversation, 5 turns each (`threads`):

| | Median time to first text | Request size |
|---|---|---|
| Stateless replay | 2.2 s | 178 KB |
| Thread | 2.9 s | new message only |

That is no gain at this size (noisy, n=5).

- A thread **fixes `tool_choice`**: changing it on a continue returned **400 `thread_fingerprint_mismatch`**, so the forced last step can't use a thread unless `tool_choice` never changes.
- Threads are **not ZDR eligible**. They are held in memory for up to an hour after last use and can't be deleted through the API.
- **Recommendation:** don't use threads for askdare; replay from the store.

**Files and history:** after the turn's two files were deleted, the next turn on the same history failed with **404 `not_found_error` "File `file_…` not found."**. On OpenAI the conversation carried on (S1 E9). Anthropic documents the same failure for an expired file. Since attachments expire after 30 days, the store must replace a file block with a text placeholder when the file is deleted or expires. The alternative is sending images and PDFs inline as base64: no retention, but larger requests. The error mapper must not read this 404 as "conversation gone".

### Q4. Knowledge (in-scope part; S8 owns retrieval)

- **Request side:** the stub retriever runs as a client tool (`search_knowledge`) and returns `search_result` blocks inside the `tool_result`, each with `source` (page URL), `title`, text `content` and `citations: { enabled: true }`.
- **Response side:** citations arrive as `search_result_location` entries: `source`, `title`, `cited_text`, `search_result_index`, `start_block_index`, `end_block_index`. They come as `citations_delta` events, and the answer is split into many `text` blocks.
- **Mapping:** `citation { index, title, url: source }`, numbered per turn by `source` as `CitationRegistry` does today (`knowledge`, `fixtures/knowledge-citations.json`). Keying by source merges two chunks of one page into one marker, the same granularity as today's per-file key. `search_result_index` counts across the whole conversation.
- **Replay:** sending the assistant blocks with their citations back on the next turn works under API version `2026-10-21`. That version **rejects** a `text` block with citations inside a *user* message, so never copy model output into a user turn.
- No hosted vector store or embeddings were used here; that is S8.

### Q5. Caching and cost

Breakpoints:

- One top-level automatic `cache_control: { type: "ephemeral" }`, which moves to the last block on every request.
- Fixed tool order and static instructions (about 1.3k tokens, above the model's 512-token minimum).
- Everything per request after the cached prefix: identity as a `role: "system"` message after the visitor's message, page context in the user message (as today). `metadata.user_id` is outside the prompt.

Over a **20-turn conversation** with tools, knowledge and replies (`conversation`):

- **96% of input tokens were cache reads**: 359k of 374k; from turn 3 on, 0.93–0.99 per turn.
- One knowledge step (`knowledge`, turn 1, step 2) read 0 cached tokens after a 1.3k write, for no reason found; it didn't recur in the conversation.

| | Claude Opus 5.5 | Same token counts at `gpt-6.1-terra` prices |
|---|---|---|
| 20-turn conversation | **0.253 USD** | 0.063 USD |
| Per turn | 0.013 USD on average (0.0055 for a greeting to 0.026 for a first knowledge turn) | ~0.003 USD |

The OpenAI side was not re-run; tokenizers differ, and OpenAI also charges per `file_search` call. The ratio follows the list prices: Opus 5.5 costs 4× terra on input, output and cached tokens. Output tokens include 544 thinking tokens over 20 turns at `low`.

### Q6. Usage and telemetry

Claude's `input_tokens` counts **only uncached** input, so the mapping is:

| `TokenUsage` | From Claude's `usage` |
|---|---|
| `inputTokens` | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` |
| `cachedInputTokens` | `cache_read_input_tokens` |
| `cacheWriteTokens` | `cache_creation_input_tokens` (5-minute TTL; `cache_creation.ephemeral_1h_input_tokens` if 1-hour TTL is used) |
| `outputTokens` | `output_tokens` |
| `reasoningTokens` | `output_tokens_details.thinking_tokens` (reported, part of `output_tokens`) |

`StepRecord.model` comes from `message.model`. With fallbacks, `usage.iterations` lists one entry per model that ran, which `onStep` could report as separate steps.

`onUsage` loses nothing. The OpenTelemetry add-on hardcodes `gen_ai.provider.name: 'openai'` (`packages/askdare-otel/src/index.ts:32`), so the provider name must come from the gateway (`anthropic`).

### Q7. Safety and errors

- **`safety_identifier` → `metadata.user_id`.** The same HMAC pseudonym was accepted.
- **Refusals:** `stop_reason: "refusal"` maps to `content_filter`. Server-side `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` was accepted on this model (`usage.iterations` present, one `message` entry). Recommendation: send it, so a mid-stream decline continues on the same stream instead of leaving half an answer. The two refusals seen in Q2 came from the unnoted `tool_choice: none` step, not from content.
- **Errors** (`errors`):

  | Case | Claude answer | askdare code |
  |---|---|---|
  | Unknown model | 404 `not_found_error` "model: …" | `bot_unavailable` |
  | Bad key | 401 `authentication_error` | `bot_unavailable` |
  | Deleted or expired file in history | 404 `not_found_error` "File `…` not found." | Repair the history (Q3), not `not_found` |
  | `tool_use` without `tool_result` | 400 "`tool_use` ids were found without `tool_result` blocks immediately after: …" | Store bug; repair as in S1 E5 |
  | Rate limit | 429 `RateLimitError` with `retry-after` (not triggered) | `upstream_error` + `retryAfterMs` |
  | Overloaded | 529 `overloaded_error` (not triggered) | `upstream_error` |
  | `role: "system"` as the first message | 400 | Never sent |

  Conversation IDs become ours, so no Anthropic 404 means "conversation gone": the store answers that.
- **`doctor`:** `models.retrieve(model)` is free and returns the ID and `max_input_tokens` (1,000,000). A one-word turn checks the key and the model, and `files.list` checks attachments. There is no transcription model or vector store to check.

### Q9. Shape of the code (recommendation; the ADR decides)

**A separate package, `@boldare/askdare-anthropic`,** exporting a gateway factory that `createChatHandler` accepts (for example a `gateway` option). It is the only module that imports `@anthropic-ai/sdk`, so core gets no new dependency and the no-leak test runs per package.

This makes `ModelGateway` a public **port implemented by an official add-on**, as `RateLimitStore` already is in ADR-0006. The port and its types (`TurnRequest`, `TokenUsage`, `ProtocolEvent`…) then become versioned API and need a cleanup first. OpenAI names leak into them today: `safetyIdentifier`, `vectorStoreId`, the reserved `file_search` name, and the `answerItemId` semantics.

A `gateway` option inside core with both SDKs as optional peers would keep one package, but would put Anthropic's SDK into every install's peer graph.

Either way `defineBot` has to know what the chosen gateway supports, and refuse `voice`, `moderation` and a `vectorStoreId` on Claude rather than fail at runtime.

## ADR input

What the provider ADR, which supersedes or extends ADR-0002, should decide, with the evidence above:

1. **Provider port:**
   - Make `ModelGateway` a public, versioned port with an official `@boldare/askdare-anthropic` add-on (Q9).
   - Rename the OpenAI-shaped fields first, with a capability set per gateway (knowledge, voice, moderation, attachments) that `defineBot` checks.
   - Telemetry takes `gen_ai.provider.name` from the gateway (Q6).
2. **Conversation state depends on S7.** Claude needs an own store that keeps the provider-native transcript append-only, about 4 KB per turn in this bot (Q3). ADR-0003 (state without a database) can't hold for Claude. Don't use message threads: no gain at chatbot sizes, `tool_choice` fixed per thread, not ZDR eligible (Q3).
3. **Attachments:**
   - Files API with `expires_in_seconds` = 30 days works for images and PDFs (Q3, `files`). Files are workspace-scoped, not ZDR eligible, at most 500 MB each.
   - Deleting or expiring a file must rewrite its blocks in the stored transcript, or every later turn fails with 404 (Q3).
4. **Reply options (amends ADR-0015):** on Claude `suggest_replies` is called *before* the answer, at the cost of one model call and ~1.7 s per turn that offers options. Alternatively, generate options in a separate request after the answer (not measured). The "options after the answer end the turn without another call" rule is OpenAI-only (Q2).
5. **Forced last step:** `tool_choice: none` plus a `role: "system"` note that tools are unavailable, and a lower `max_tokens` on that step. The note fixed 4 of 4 runs; without it, 6 of 8 failed, one costing 0.32 USD (Q2).
6. **Per-request context after the cached prefix:** identity and output-check notes become mid-conversation `role: "system"` messages, never part of `system`. This kept 96% of input cached over 20 turns (Q5).
7. **Safety:**
   - `metadata.user_id` replaces `safety_identifier`.
   - Send `fallbacks: "default"` (beta) and map `refusal` to `content_filter`.
   - Decide whether the protocol needs a "discard partial answer" signal for platforms without fallbacks (Q1, Q7).
   - Moderation (ADR-0019) is unavailable on Claude unless another provider supplies it.
8. **Voice** is unavailable on Claude (no speech-to-text at Anthropic); `defineBot` refuses `voice` with this gateway.
9. **Cost and latency in the docs:** at list prices Opus 5.5 costs about 4× `gpt-6.1-terra` per conversation (0.25 vs 0.06 USD for 20 turns). Knowledge answers start about 2× later (median 6.0 s vs 2.7–3.0 s). Not compared, and it needs the user's approval to add: a cheaper Claude model. The library stays model-agnostic either way.
