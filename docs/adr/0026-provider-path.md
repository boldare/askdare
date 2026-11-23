# ADR-0026: The provider path: one turn loop, provider profiles, then native adapters

- **Status:** Proposed
- **Date:** 2026-11-23
- **Extends:** [ADR-0002](0002-openai-only-no-leaked-types.md). The official `openai` SDK, the Responses wire format, `src/openai/` as the only module that imports `openai`, and no foreign types in the public API all stay. ADR-0002's "OpenAI only" becomes "OpenAI by default, other providers through profiles", from 0.9.
- **Amends, for Claude only:** [ADR-0015](0015-reply-options.md) variant A (decision 6).
- **Evidence:** spikes S6a ([findings](../../spikes/s6-claude/FINDINGS.md)) and S6b ([findings](../../spikes/s6b-open-responses/FINDINGS.md)).

## Context

Two spikes looked at a second model provider:
- **S6a, Claude natively** (`@anthropic-ai/sdk`): go, with conditions. Every protocol event has a Claude source and caching held 96 % over 20 turns. But it needs an own conversation store and own retrieval; `suggest_replies` must come before the answer, or the answer disappears (0 of 3); the forced last step needs a system note (6 of 8 runs failed without it); deleted or expired files in history make every later turn fail; and there is no voice or moderation. About 4× the cost of `gpt-6.1-terra` per conversation, and knowledge answers start about 2× later.
- **S6b, Open Responses endpoints through the same `openai` SDK:** go, with conditions, for OpenRouter. The stream mapper ran unchanged on every endpoint, with 0 exceptions, and stateless replay worked everywhere. What differs per endpoint is small and server-side: error shapes, a field that turns on prompt caching (Claude through OpenRouter cached 0 % without `cache_control` and 94 % with it), the forced-last-step note, and model quality (`gpt-oss-120b` failed: no parallel calls, no `suggest_replies`, tool-output markers leaked into 11 of 20 answers).
- **Hugging Face and local servers were not verified, not rejected.** Hugging Face answered every model call with 402 for want of pre-paid credits, so only its request validation and error shapes were seen: every error arrives as HTTP 200 with `response.failed`, and it refuses `allowed_tools`. The 16 GB laptop couldn't run a local model through a whole experiment.

Both spikes need what 0.6 builds anyway: conversation state outside the provider ([ADR-0024](0024-conversation-store.md)) and retrieval as a function tool ([ADR-0025](0025-knowledge-index.md)).

## Decision

1. **0.6 splits the gateway, and adds no provider.** Conversation state and retrieval move out of `ModelGateway` into their ports, the turn loop gains its stateless mode for item stores, and knowledge on an index becomes a function tool. After that a second provider only has to run turns. `ModelGateway` stays internal in 0.6; fields with OpenAI names (`safetyIdentifier`, `vectorStoreId`, the reserved `file_search`, the meaning of `answerItemId`) are renamed while they still can be, as each 0.6 task touches them.
2. **The second provider path is a profile of `src/openai/`, not a new module** (0.9). The same SDK, request builder, stream mapper and tool loop serve every endpoint that speaks the Responses wire format. A **provider profile**, chosen in server configuration and never by the client (ADR-0004), holds:
   - the `baseURL` and the name of its key's environment variable;
   - **state:** `conversations` (OpenAI only) or `stateless` (an item store is required, `store: false`, encrypted reasoning replayed). A stateless profile refuses a provider store at startup, and never sends `conversation`, which OpenRouter silently ignores;
   - **extra request fields** the provider needs, such as top-level `cache_control` for Claude on OpenRouter;
   - **capabilities:** `allowed_tools` (without it, `suggest_replies` is dropped from the tool list on a later step instead), moderation, files, transcription and hosted search, checked by `defineBot` and `createChatHandler` at startup rather than failing at runtime;
   - **the forced-last-step note:** a line in the instructions that tools are unavailable, for models that return nothing under `tool_choice: 'none'`, plus a lower output limit on that step;
   - **an error classifier** on top of today's mapping: 402 and an unknown model become `bot_unavailable`, a context-length message becomes `error.conversationTooLong`, and a `store` or `previous_response_id` refusal is a configuration error that `doctor` reports.
3. **Supported in 0.9:** OpenAI (`conversations` or `stateless`) and OpenRouter (`stateless`). Each profile is supported **for verified models only**, listed in the docs, not in code (the library names no model IDs). A model is verified by rerunning S6b's probes (`spikes/s6b-open-responses/`): stream conformance, parallel calls, `suggest_replies`, the forced last step, replay and errors. Claude Haiku 5.5 through OpenRouter passed; `gpt-oss-120b` did not.
4. **Hugging Face and local servers (Ollama and others): not verified in 0.6, and left open.** The profile shape above is meant to take them; a profile for each is added once a verification run passes. What that run must look at:
   - errors that arrive as HTTP 200 with `response.failed` (Hugging Face), which need the classifier to read the status out of the in-stream error;
   - Hugging Face refusing `allowed_tools`, which needs the fallback in decision 2;
   - a local step that spends its whole output on reasoning and still ends `completed` (seen once on Ollama), which must map to `max_output_tokens`.

   The run needs a funded Hugging Face account (about 5 USD) and a machine that can run a local model with tools; it is a roadmap line, not a 0.6 task.
5. **Native adapters come later, as add-ons.** A native Claude adapter (`@boldare/askdare-anthropic`) is the first, when a client needs what the Responses wire format can't give. It makes `ModelGateway` a public port implemented by an official add-on, as `RateLimitStore` is (ADR-0006), so the port gets a review first. Its conditions, from S6a:
   - an item store (ADR-0024) that keeps Claude's assistant content exactly, as `native` items, and replaces a file block with a text placeholder when its file is deleted or expires;
   - own retrieval (ADR-0025), with `search_result` blocks whose `source` is the source ID;
   - per-request context (identity, guardrail notes) as `role: "system"` messages after the cached prefix, never in `system`;
   - `metadata.user_id` instead of `safety_identifier`, server-side `fallbacks`, and `refusal` mapped to `content_filter`;
   - no voice and no moderation on that gateway, refused by `defineBot`;
   - usage mapped so `inputTokens` includes cached and written tokens, and the OpenTelemetry add-on takes `gen_ai.provider.name` from the gateway instead of hardcoding `openai`.
   - Message threads are not used: no gain at chatbot sizes, `tool_choice` fixed per thread, and not ZDR-eligible.
6. **Reply options on Claude** (amends ADR-0015 variant A for Claude only): on the native Messages API, `suggest_replies` is called **before** the answer, because text written before a tool call comes back as an empty thinking block. It costs one more model call (about 1.7 s) on turns that offer options. A profile or adapter says `replies: 'after' | 'before' | 'off'` per verified model. Through OpenRouter, Claude Haiku called it after the answer as ADR-0015 expects. OpenAI is unchanged.
7. **Shared guards, whatever the provider:**
   - Zod re-validation of tool arguments stays mandatory: OpenRouter accepted `strict` schemas OpenAI rejects and didn't enforce them.
   - Output sanitising strips `【…】`-style tool-output markers before rendering.
   - Usage reads optional fields defensively (`input_tokens_details`, cache writes), and a provider's charged `usage.cost`, when present, is passed to `onStep` as an optional field.

## Consequences

- 0.6 ships no new provider but leaves only the turn to write for one. The seams are proven by OpenAI's own stateless mode, which S7 measured at the same cost as conversation mode.
- 0.9's profile work is small: S6b ran four endpoints through the library's own mapper unchanged. Supporting a model costs a verification run, not code.
- The supported list stays short and explicit. "Any endpoint that claims Open Responses" is not a support promise.
- Without moderation, files or transcription on a profile, those features are off for its bots; `doctor` and startup checks say so.
- A native Claude adapter costs a public `ModelGateway` port, the replies-first variant, and docs that warn about cost and latency.

## Alternatives considered

- **Native Claude first, in 0.6:** it needs the most change (a public gateway port, a new SDK in an add-on, replies-first) for a provider S6b reaches through OpenRouter with the existing module.
- **Any Open Responses endpoint, unverified:** S6b found a model that leaks tool-output markers into answers and another endpoint that hides every error behind HTTP 200. Unverified models would fail in ways visitors see.
- **Rejecting Hugging Face and local servers:** S6b couldn't run them, which says nothing about whether they work. A profile slot and a verification run cost little.
- **The Vercel AI SDK or `@openai/agents` as the multi-provider layer:** ADR-0002's reasons stand: leaked types and breaking minors, and askdare's own protocol, tool loop and guardrails would sit on top anyway.
- **Anthropic message threads for Claude's state:** see decision 5.
