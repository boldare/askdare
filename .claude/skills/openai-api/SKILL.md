---
name: openai-api
description: Rules for any code or docs in chatdock that touch the OpenAI API (Responses, Conversations, Files, vector stores, file_search, transcription). Use before adding or changing an OpenAI call, parameter, model reference, stream mapping or fixture.
---

# Working with the OpenAI API in chatdock

## 1. Check the docs first: your memory is stale

The OpenAI platform changes monthly. Assistants and Prompts were shut down, and models and parameters keep getting renamed. Before using an endpoint, parameter, event type, tool type or model name:
- Use the `openaiDeveloperDocs` MCP server: `search_openai_docs` to find the topic, `fetch_openai_doc` to read it, and `get_openapi_spec` for exact request and response shapes.
- Note the doc URL in the PR description or a code comment where the behaviour is non-obvious.

## 2. Allowed APIs

- **Responses API** (`client.responses.*`) for generation, streaming and tool calls.
- **Conversations API** (`client.conversations.*`) for conversation state (ADR-0003).
- **Files and vector stores** for the knowledge base and attachments.
- **Audio transcriptions** with the current transcription model, chosen through bot config.
- **Never use:**
  - the Assistants API (shut down);
  - Prompt objects (`prompt: { id }`, shut down 2026-11-30);
  - Chat Completions for new code.

## 3. Boundaries

- Only `packages/chatdock/src/openai/` imports `openai`. Everything else uses our domain types.
- Map OpenAI stream events to our versioned SSE protocol (`src/protocol/`). **Never forward raw events**; tool arguments, tool outputs and reasoning stay on the server.
- When mapping items or events, **ignore unknown types**. New variants appear in SDK minor releases.
- No OpenAI types in exported signatures. The no-leak test enforces this.

## 4. Request defaults (server-side, never client-controlled)

- `model` comes from `defineBot`. **No model IDs are hardcoded in the library.** Defaults belong in `examples/starter`.
- Always set:
  - `max_output_tokens`;
  - `safety_identifier` (a hash of `visitorId`);
  - `prompt_cache_key`;
  - an explicit SDK `timeout` and `maxRetries`;
  - an `AbortSignal`.
- Dynamic context (page URL, identity) goes into per-request `instructions`, never into stored conversation items.
- Always send `store: true` with `conversation`. With `store: false` the turn is silently not added to the conversation (verified in spike S1).
- Tool loop:
  - Tools are built with `zodResponsesFunction` (strict).
  - Arguments are re-validated with Zod.
  - Calls run in parallel via `Promise.allSettled`, each with a timeout and an output size cap.
  - On the last allowed step function calls are switched off: `tool_choice: 'none'`, or `allowed_tools` with only `file_search` when the bot has a knowledge base (keeps the tool list and prompt cache intact).
- Knowledge base (`file_search`):
  - Send `include: ['file_search_call.results']` on `responses.create` and on `conversations.items.list`. Citations take their title and URL from the results' file attributes.
  - `chatdock kb sync` owns the attributes `path`, `sha256`, `title` and `url` (max 16 keys, values up to 512 characters). Change them in one place: `src/openai/knowledge-sync.ts` and `src/openai/citations.ts`.
  - Only http(s) URLs from attributes reach the client.

## 5. Tests and live calls

- Unit and integration tests use **recorded, redacted SSE fixtures** replayed with MSW (`http.post`). No network.
- Live calls only in `scripts/smoke-*.ts`, with a key from a dedicated OpenAI project that has a **hard spend limit**. Never print or commit keys.
- Clean up created resources (files, vector stores, conversations) in live scripts.

## 6. Logging

Never log message content, file contents or PII. Log request IDs, status codes, token usage and stable error codes only.
