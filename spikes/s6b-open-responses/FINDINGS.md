# Spike S6b: Open Responses endpoints behind the OpenAI gateway

- **Date:** 2026-11-21 to 2026-11-23
- **Task:** `tasks/0.6-s6b-open-responses.md` (feeds the provider ADR that task P1 writes)
- **Spec:** [Open Responses](https://www.openresponses.org/specification), reference version 2026-04-24
- **SDK:** `openai` 7.56.0, the version `packages/askdare` resolves to. The library code is unchanged; `turn.ts` here is a stateless copy of `src/openai/turn.ts`, `stream-mapper.ts`, `tools.ts` and `errors.ts`.
- **Endpoints and models** (approved by the user; named only in this spike):

  | Name in results | Endpoint | Model |
  |---|---|---|
  | `or-haiku` | OpenRouter `https://openrouter.ai/api/v1` | `anthropic/claude-haiku-5.5` |
  | `or-haiku-cc` | same, plus top-level `cache_control: {type: 'ephemeral'}` | same |
  | `or-oss` | OpenRouter | `openai/gpt-oss-120b` |
  | `hf-oss` | Hugging Face router `https://router.huggingface.co/v1` | `openai/gpt-oss-120b` |
  | `ollama` | local Ollama 0.40.17 `http://localhost:11434/v1` | `qwen3:4b` |
  | `openai-terra` | OpenAI (baseline, same stateless request) | `gpt-6.1-terra` |

- **Run:** `pnpm install --ignore-workspace`, keys in `.env` (see `.env.example`), then `pnpm start <endpoint|all> [experiment…]`. Experiments: `stream`, `tools`, `finalStep`, `strict`, `errors`, `overflow`, `conversation`. `probe-none.ts` is the follow-up on Claude's empty forced last step.
- **Cost:** about **0.066 USD** in total: OpenAI 0.032 USD (list prices × reported usage), OpenRouter 0.033 USD (its own `usage.cost`), Hugging Face and Ollama 0.
- **What didn't run:**
  - Hugging Face: the token works, but every model call answered 402 "Purchase pre-paid credits", so only its request validation and error shapes are measured.
  - Ollama: `gpt-oss:20b` didn't fit in the 16 GB M1 (0.3 tokens/s; the server dropped the stream after 7.5 min). `qwen3:4b` ran only `stream` before the laptop froze and the user stopped it.
  - Rate limits (429) were not provoked.

## Verdict: go, with conditions, for OpenRouter as the second-provider path. No-go for Hugging Face and local servers as supported targets in 0.6

The stream mapper needs no change: the library's `ResponseStreamMapper`, copied line for line, turned the streams of all four endpoints that answered into the same `ProtocolEvent`s without one exception. The tool loop works on Claude Haiku through OpenRouter, including parallel calls and `suggest_replies` after the answer. Stateless replay of the whole history (reasoning items included) works everywhere.

What does **not** carry over unchanged:
- **Error mapping:** `errors.ts` assumes OpenAI's status codes and error codes. On these endpoints a missing credit balance, an unknown model and a context overflow all become `upstream_error`. Hugging Face sends every error as HTTP 200 plus `response.failed`.
- **Prompt caching** needs a provider-specific request field. Without it, Claude through OpenRouter cached 0% over 20 turns; with it, 94%, at a quarter of the cost.
- **The forced last step** (`tool_choice: 'none'`) gives Claude an empty answer unless the instructions say tools are unavailable.
- **Model quality varies:** `gpt-oss-120b` ignored `parallel_tool_calls` and never called `suggest_replies` in 20 turns. It also leaked tool-output markers into answers and once answered the forced last step with raw JSON.

So the second gateway is cheap to build. Making it safe needs per-provider profiles and a short list of supported models, not "any endpoint that claims Open Responses".

## 1. Stream mapper

The probe kept every raw event (`fixtures/*-stream.json`, `*-tools.json`) and checked them against the 24 event types of the 2026-04-24 reference.

| | OpenAI (baseline) | OpenRouter Haiku | OpenRouter gpt-oss | Ollama qwen3 | Hugging Face |
|---|---|---|---|---|---|
| Mapper exceptions | 0 | 0 | 0 | 0 | — |
| Event order (created → in_progress → output_item/content_part → completed) | yes | yes | yes | yes | `created`, `in_progress`, `failed` only |
| `sequence_number`, increasing | yes | yes | yes | yes | yes |
| Events outside the spec | none | none | `response.reasoning_text.delta/.done` | none | none |
| Message `phase` | `final_answer` | **absent** | **absent** | **absent** | — |
| Reasoning items | encrypted only | yes (with Anthropic `signature`) | yes, plain-text deltas | summary-text deltas | — |
| `usage.input_tokens_details.cached_tokens` | yes | yes | yes | yes | — |
| `cache_write_tokens` | yes | yes | **absent** | **absent** | — |
| `output_tokens_details.reasoning_tokens` | yes | yes | yes | always 0 | — |
| `usage.cost` (USD) | no | yes | yes | no | — |
| `response.model` | yes | yes | yes | yes | — |

Differences that matter:
- **`phase` is absent** outside OpenAI, so `answerItemId` is simply the step's last message. The loop handles that, but commentary written before a tool call can no longer be told apart from the answer. For rating, the item ID that matters is the last one, so nothing breaks.
- **OpenRouter's gpt-oss streams `response.reasoning_text.*`**, OpenAI's own names; the spec calls them `response.reasoning.*`. The mapper ignores both, as reasoning content never reaches the client.
- **End reasons:** no endpoint sent `response.incomplete` in these runs. Ollama ended a step that spent all 1,024 output tokens on reasoning, with no message, as `response.completed`: from the usage alone, `max_output_tokens` would have been missed. Seen once; the fixture of that run was not kept.
- **Hugging Face sends failures in-stream:** HTTP 200, then `response.created`, `response.in_progress`, `response.failed` with `error.code: "server_error"`. The mapper throws `upstream_error`, which is correct by the spec but loses the real cause (see 3).
- The library reads `usage.input_tokens_details.cached_tokens` without `?.`. Every endpoint sent the object, which the spec requires, so nothing crashed, but one optional chain would make a non-conforming server fail soft.

## 2. Tool loop

Same bot as S6a: its instructions and tools, the stub `search_knowledge` in place of `file_search`, `suggest_replies`, and the failing `get_exchange_rate`.

| | OpenAI terra | OR Haiku | OR gpt-oss | HF |
|---|---|---|---|---|
| Parallel calls in one step (time ×2 + rate) | yes (3 in 1 step) | yes (3 in 1 step) | **no**: 1 per step, rate retried, hit `maxSteps` 5 | — |
| Arguments valid against Zod | 3/3 | 3/3 | 4/4 | — |
| `strict: true` on a schema OpenAI rejects (no `additionalProperties: false`, optional field) | 400 (known) | **accepted** | **accepted** | — |
| `tool_choice: 'required'` | — | honoured | honoured | — |
| `tool_choice: 'none'`, forced last step, first step | text answer | **empty output** (`completed`, 1 output token) | answered `{"location":"Warsaw"}` as text | — |
| `allowed_tools` (bot tools only, `suggest_replies` listed) | honoured 2/2 | honoured 2/2 | honoured 2/2 | **400**: only `'auto' \| 'none' \| 'required'` accepted |
| Unknown function name in `tool_choice` | — | ignored, answered | ignored, answered | — |
| `suggest_replies` in the 20-turn run | 17/20 turns | 19/20 | **0/20** | — |

- **Strict is not enforced** on OpenRouter for either model. The library's Zod re-validation of arguments stays mandatory; it already is.
- **The empty forced last step on Claude** (`probe-none.ts`, `results-none.json`): with tools listed and `tool_choice: 'none'`, Haiku returned no output items at all, three times. Adding "Tools are unavailable for this answer: answer in text now." to the instructions fixed it. S6a found the same on the native API. Through OpenRouter the step looks like a normal completed turn with an empty answer, so the loop needs the note, or a check for an empty last step.
- **`suggest_replies` after the answer works on Claude through OpenRouter** (text, then the call in the same response), as ADR-0015 expects. This differs from S6a's native finding (there the call after the answer emptied the answer). With `cache_control` on, Haiku stopped suggesting after turn 13 of 20. That is model variance, not caching: the request was otherwise identical.
- **gpt-oss-120b** called `suggest_replies` *instead of* answering in 2 of 3 greetings, costing one extra step each, and wrote suggested replies as text in the tools turn. In 11 of its 20 conversation answers it leaked `【untrusted_tool_result.results[0].text】`-style markers into the visible text. That is unsafe to render as-is, and a reason not to support the model.
- **Replay:** `function_call`, `function_call_output`, `message` and `reasoning` items from earlier steps went back as `input` on every endpoint without a single 400. That includes Claude's reasoning items with `signature` and OpenAI's with `encrypted_content` (requested through `include: ['reasoning.encrypted_content']`, which every endpoint accepted).

## 3. Usage and errors

Usage carried cached and reasoning tokens everywhere (see 1). Cache writes are missing on gpt-oss and Ollama; the mapper already defaults them to 0. OpenRouter's `usage.cost` is the charged amount and matched list prices for Haiku; for gpt-oss it was 37% of the worst-case list price, as the upstream provider varies.

Errors, with what today's `fromOpenAIError` makes of them:

| Case | OpenAI (S1) | OpenRouter | Hugging Face | Mapped today | Should be |
|---|---|---|---|---|---|
| Unknown model | 404 `model_not_found` | 400, `code: 400` (a number), "not a valid model ID" | HTTP 200, `failed`, `server_error`, message "400 The requested model … does not exist" | `bot_unavailable` / **`upstream_error`** / **`upstream_error`** | `bot_unavailable` |
| Invalid key | 401 | 401 "Missing Authentication header" | HTTP 200, `failed`, message "401 Invalid username or password." | `bot_unavailable` / `bot_unavailable` / **`upstream_error`** | `bot_unavailable` |
| No credits | not tested | **402**, "Insufficient credits" | HTTP 200, `failed`, message "402 Purchase pre-paid credits…" | `upstream_error` (all) | `bot_unavailable` |
| Context overflow | 400 `context_length_exceeded` | 400, `code: 400`, "maximum context length is 131072 tokens" (with `truncation: 'auto'` and `'disabled'` alike) | not reached | `conversationTooLong` / **`upstream_error`** | `conversationTooLong` |
| `store: true` | ok (the library sends it) | 400 `invalid_prompt` "not supported on this proxy" | not reached | `upstream_error` | config error at startup |
| `previous_response_id` | not tested | 400 `invalid_prompt`, same | not reached | `upstream_error` | — (never sent statelessly) |
| `conversation` | ok (the library sends it) | **silently ignored** | not reached | — | never sent |
| Bad `tool_choice` | not tested | silently ignored | 400 with a bare Zod issue array as body | `upstream_error` | — |

- OpenRouter's error body is `{ error: { code, message, metadata } }`, with `code` sometimes the HTTP status as a number and sometimes a string (`invalid_prompt`).
- Hugging Face reports even a wrong key as HTTP 200. Telling configuration errors from outages there means parsing the status out of the message text, which is fragile.
- **`truncation: 'auto'` is not honoured** by OpenRouter on gpt-oss: overflow is a 400 either way. A stateless gateway has to trim history itself (S7's store), not rely on the endpoint.

## 4. Caching and cost (20 turns, S6a's script, stateless replay)

| | Cached input | Cost, 20 turns | Per turn | Median time to first text |
|---|---|---|---|---|
| OpenAI `gpt-6.1-terra` (baseline) | 92% | 0.0253 USD | 0.00126 USD | 1.55 s |
| OR Haiku, today's request (`prompt_cache_key` only) | **0%** | 0.0194 USD | 0.00097 USD | 0.77 s |
| OR Haiku + top-level `cache_control` | 94% | **0.0046 USD** | **0.00023 USD** | 0.72 s |
| OR gpt-oss-120b | 66%, uneven | 0.0053 USD | 0.00026 USD | 0.47 s |
| Ollama qwen3:4b (M1, 16 GB) | cached reported | 0 | 0 | 14.3 s; froze the laptop |

- **A stable prefix caches across turns only when the request asks for it the provider's way.** OpenRouter documents `prompt_cache_key` as a sticky-routing key, not as a cache switch for Anthropic, and the 0% confirms it. With `cache_control` the cache breakpoint moved forward each turn: from turn 2 on, every step read the whole previous prefix. Caching cut Haiku's cost 4.2×.
- **gpt-oss caching depends on which upstream provider OpenRouter routes to.** Turns 7, 12, 13, 18 and 20 dropped to 0–64 cached tokens, the signature of a different provider. OpenRouter's `session_id` sticky routing could fix that; it was not tested.
- **Against today's default:** with caching on, a typical turn on Claude Haiku 5.5 cost about a fifth of `gpt-6.1-terra` on the same tokens (0.00023 against 0.00126 USD), and the first text came twice as fast. Haiku used more input tokens (143k against 107k for 20 turns), as its tool definitions and answers are longer. This compares the cheapest Claude with OpenAI's default model, not equal quality. S6a measures the larger Claude models natively.
- Today's library uses the Conversations API, not stateless replay. The terra row gives the same history at the same prices, so it stands in for today's cost.

## 5. What stays OpenAI-only

The spec has only `POST /v1/responses` (plus `/compact` and WebSocket). None of the following has an equivalent in it, and none was available on the tested endpoints in a compatible form:

| Capability | Open Responses / OpenRouter / HF | What core does without it |
|---|---|---|
| `moderate` | none | already optional: skip, or keep an OpenAI key just for moderation (it is free) |
| `uploadFile` (Files API, `file_id`) | none; the spec has inline `input_file`/`input_image` content only | attachments off, or inline data from an own file store (needs its own spike; not tested) |
| `transcribe` | none in the spec | voice input off for that bot |
| `file_search` | none (hosted tools are optional and provider-specific) | S8's own retrieval as a `search_knowledge` function tool |
| `diagnose` | partly: checks of OpenAI projects, vector stores and the Conversations API make no sense; a model check could use `GET /models` (not tested) | a reduced, per-gateway diagnose |
| Conversations | none; OpenRouter refuses `store` and `previous_response_id`, ignores `conversation` | S7's own store and stateless replay |

## 6. Shape of the code (recommendation)

A second gateway should be a **configuration of the existing `src/openai/` module**, not a module of its own: same SDK, same request builder, same stream mapper, same tool loop. What it needs is a small **provider profile** chosen in `defineBot` (never by the client):
- `baseURL` and the key's env name;
- **stateless mode:** no `conversation`, `store: false`, history from the own store (S7), and the `include` for encrypted reasoning;
- **extra body fields** that are provider-specific but server-controlled, e.g. `cache_control` for Claude on OpenRouter;
- **capability flags:** `allowedTools` (else fall back to dropping `suggest_replies` from the tool list on a later step), plus `moderation`, `files`, `transcription` and hosted search;
- **a forced-last-step note** in the instructions, for models that return nothing under `tool_choice: 'none'`;
- **an error classifier per profile:** 402 → `bot_unavailable`; 400 with "not a valid model" → `bot_unavailable`; 400 matching a context-length message → `conversationTooLong`. Hugging Face would need the status parsed out of `response.failed`.

The split along the module boundary is about conversation state, not the wire protocol. "OpenAI with the Conversations API" and "stateless with an own store" are the two variants. The OpenAI baseline ran statelessly with 92% caching, so the stateless variant could later serve OpenAI too.

## ADR input (for P1)

- **Decision candidate:** extend ADR-0002 to "one gateway module speaking the Responses wire format, with provider profiles". Supported in 0.6: OpenAI (Conversations or stateless) and OpenRouter (stateless), each profile with a list of **verified models**. Claude Haiku 5.5 verified here; `gpt-oss-120b` explicitly not (no parallel calls, no `suggest_replies`, leaks tool-output markers). Hugging Face and local servers are not supported: HF refuses `allowed_tools` and hides errors in HTTP 200, and local inference is out of reach of a laptop.
- **Requires S7:** the stateless profile needs the own conversation store. Replay was verified with reasoning items (Claude `signature`, OpenAI `encrypted_content`) and function-call items, verbatim and append-only.
- **Requires S8:** no hosted `file_search` outside OpenAI; knowledge must be the own `search_knowledge` tool. Its results went through all three endpoints fine.
- **ADR-0015 (reply options):** holds on Claude through OpenRouter (call after the answer, in the same response). Models that call it before answering cost one extra step; models that never call it lose the feature silently. A profile needs `replies: 'suggest' | 'off'` per verified model.
- **ADR-0012 (telemetry and usage):**
  - Cached and reasoning tokens are present everywhere; `cache_write_tokens` is optional, so keep the `?? 0`.
  - OpenRouter returns the charged `usage.cost`. Worth carrying in `onStep` usage as an optional field, since list prices don't apply when the upstream provider varies.
  - Make `input_tokens_details` optional-chained.
- **ADR-0022 (guardrails):**
  - Strict tool schemas are not enforced off OpenAI, so Zod re-validation stays mandatory.
  - The untrusted-result wrapper key leaked into gpt-oss answers. Output sanitizing should strip `【…】` markers, or the model stays unsupported.
  - Moderation remains OpenAI-only and optional.
- **ADR-0004 (threat model):** the profile and its extra body fields are server config. `conversation` is silently ignored by OpenRouter, so a stateless profile must never fall back on it for isolation.
- **Errors:** add `402` and provider messages to the mapping (table in 3). Treat `store`/`previous_response_id` refusals as configuration errors found at startup, which is a job for `diagnose`.
- **Truncation:** `truncation: 'auto'` is not honoured off OpenAI. The stateless profile must trim or compact history itself before the context limit.
- **Open questions:**
  - 429 shapes and `retry-after` on OpenRouter (not provoked).
  - OpenRouter `session_id` for sticky caching on open-weight models.
  - Attachments as inline `input_file` data.
  - Hugging Face with credits, if anyone needs it.

## Files

- `turn.ts`: the stateless copy of the library's turn, mapper, tools and error mapping; same bot as S6a.
- `s6b.ts`: the experiments, conformance check and budget; `results.json` is its merged output.
- `probe-none.ts`, `results-none.json`: Claude's empty forced last step and the fix.
- `fixtures/`: raw stream events (`*-stream.json`, `*-tools.json`) and replayed histories (`*-conversation-history.json`). Encrypted reasoning and signatures are replaced with `<redacted>`; no keys or request headers were recorded. The texts are the spike's own test prompts.

## Sources

- Open Responses specification and reference 2026-04-24: https://www.openresponses.org/specification, https://www.openresponses.org/reference/2026-04-24, changelog https://www.openresponses.org/changelog
- OpenRouter Responses API: https://openrouter.ai/docs/api_reference/responses/overview.md (stateless; `store` and `previous_response_id` refused), error handling https://openrouter.ai/docs/api_reference/responses/error-handling.md, prompt caching https://openrouter.ai/docs/guides/best-practices/prompt-caching.md (top-level `cache_control`; `prompt_cache_key` as sticky-routing key)
- Model pages and prices (2026-11-23): https://openrouter.ai/anthropic/claude-haiku-5.5, https://openrouter.ai/openai/gpt-oss-120b; OpenAI prices as in S5b (https://developers.openai.com/api/docs/pricing)
- Hugging Face Responses API (beta): https://huggingface.co/docs/inference-providers/guides/responses-api
- Sibling spikes: S6a hand-over (Claude forced last step, `suggest_replies` order), S8 hand-over (own retrieval as `search_knowledge`).
