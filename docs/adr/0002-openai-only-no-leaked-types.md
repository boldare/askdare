# ADR-0002: OpenAI only, official SDK, no leaked types

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

- **v1 broke because of leaked types.** It exposed OpenAI beta types in its public API, so SDK changes broke consumers. Issue #89 was a build failure after an `openai` minor bump.
- **The SDK can break types in minors.** The `openai` SDK's own policy allows type-level breaking changes in minor releases; 7.40 to 7.45.1 shipped within seven days. v7 requires Node 22.
- **Prompt objects are going away.** OpenAI points Assistants users to dashboard "Prompts" objects as the replacement, but `v1/prompts` and reusable prompt objects shut down on 2026-11-30.
- **The model list moves monthly.** OpenAI's models and deprecations change every month.

## Decision

- **Official SDK only.** Use the official `openai` SDK (^7) and the **Responses API**. Neither the Vercel AI SDK nor `@openai/agents` is used in 0.1. The Agents SDK is pre-1.0 and ships breaking changes in minors.
- **Regular dependency.** `openai` is a regular dependency, not a peer, so consumers never need to manage its version.
- **One gateway module.** Only `src/openai/` may import `openai`, enforced by a lint import restriction. It holds the gateway, the tool loop, error mapping and annotation mapping.
- **No foreign types in the public API.** Published `.d.ts` files contain **no `openai` or `next` types**, enforced by a CI "no-leak" test. The public API uses our own domain types and our own **versioned SSE protocol**. Raw OpenAI stream events are never forwarded to clients.
- **Own lightweight tool loop:**
  - `zodResponsesFunction` builds strict tools.
  - Arguments are validated with Zod.
  - Parallel calls run via `Promise.allSettled` with per-tool timeouts and output size caps.
  - The step limit is enforced, and the final step forces an answer (`tool_choice: 'none'`).
- **Instructions live in code** (`defineBot({ instructions })`), never in dashboard objects.
- **No hardcoded model IDs.** `model` is required in `defineBot`. Defaults live in `examples/starter`, and the nightly canary checks they still exist.

## Consequences

- SDK type churn is contained in one module and can't reach consumers' builds.
- We own the streaming protocol and the tool loop: a few hundred lines that need thorough fixture tests.
- Vendor lock-in to OpenAI is accepted. The `ConversationStore` port (ADR-0003) and our own domain types keep the cost of a future provider or API change local.
