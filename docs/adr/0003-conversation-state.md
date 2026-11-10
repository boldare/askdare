# ADR-0003: Conversation state without a database

- **Status:** Accepted on 2026-10-29 after spike S1 ([findings](../../spikes/s1-openai/FINDINGS.md)).
- **Date:** 2026-10-29

## Context

The library must be easy to embed: `OPENAI_API_KEY` plus `CHAT_SECRET` should be enough. The OpenAI Conversations API stores a whole conversation under one `conv_…` object: messages, tool calls and tool outputs. Each turn passes only `conversation: id`.

Two lessons shape the design:
- **v1 lost all history when OpenAI shut down Assistants.** Whatever stores conversations must sit behind an abstraction.
- **Visitors don't need a list of their conversations.** The widget shows only the current one and resumes it after a reload. Browsing all conversations, retention and GDPR exports are the **site owner's** needs.

## Decision

- **Default store.** The OpenAI Conversations API, accessed through a `ConversationStore` port:
  - `openaiConversations()` is the default;
  - `memory()` is for tests.
- **No database or queue is required.**
- **Ownership without a database.** The resume token carries the conversation ID, encrypted and authenticated (JWE, `dir` + A256GCM, keyed by `CHAT_SECRET`), so the browser can neither read nor change it. On top of that, the conversation object stores `metadata: { bot, visitor }` as defense in depth.
- **History on reload.** `conversations.items.list(conv, { order: 'asc' })` maps items to domain types and ignores unknown item types. Only user and assistant messages plus citations are shown; tool calls and reasoning stay hidden.
- **Dynamic context.** Page URL, identity and similar go into per-request `instructions`. They are never stored in the conversation.
- **Deletion.** `DELETE <basePath>/conversation` plus the "start a new conversation" button removes the conversation and its uploaded files. The conversation comes from the visitor's signed resume token, never from the URL.
- **Own storage is an add-on.** Redis or Postgres (`@boldare/askdare-store-postgres`, after 0.1) covers retention, export, ZDR/EU data residency and independence from OpenAI.

## Consequences and trade-offs (documented in the README)

1. **No automatic retention or admin browsing in core.** The API has no endpoint to list conversations, so conversations live until deleted.
2. **Data stays at OpenAI until deleted.** Conversations are not ZDR-eligible, and responses are also stored for 30 days.
3. **Long conversations get expensive.** They replay their full history as input, so we enforce turn limits and a stable prompt prefix for caching. **Compaction is planned for 0.2** (2026-10-30): OpenAI's server-side compaction (`context_management: [{ type: 'compaction', compact_threshold }]`) replaces the deprecated `truncation`, but its guide doesn't yet say how it works with the `conversation` parameter, so it needs a spike first. Until then, 0.1 sends `truncation: 'auto'`, which the API still accepts. Spike S5 moved compaction to 0.3 (see the update of 2026-11-09 below).
4. **Attachments after reload show only as a filename or placeholder.** Content of `user_data` files cannot be downloaded back.

## Evidence (spike S1, live API, 2026-10-29)

- **Streaming:** turns inside a conversation stream normally. Time to first token was 0.9–1.3 s on `gpt-6.1-terra`.
- **Function calls:** a dangling call breaks the next turn with a 400. A synthetic `function_call_output` repairs it, so the step 3.2 tool loop must answer every call.
- **Attachments:** deleting or expiring a file does not break the conversation. Images and PDFs both work with purpose `user_data`.
- **`store: false`** with a conversation silently drops the turn. **Always send `store: true`.**
- **`items.list`:** about 1.9 s, with descending default order. Load history once, with `order: 'asc'`, and show a loading state.
- **Errors:** a deleted conversation gives a 404 that mentions the conversation; an unknown model gives a 404 with `model_not_found`. The two are mapped differently (`not_found` vs `bot_unavailable`).

## Update (2026-11-09): compaction, spike S5

[Spike S5](../../spikes/s5-compaction/README.md) tested `context_management: [{ type: 'compaction', compact_threshold }]` live, sent exactly as `turn.ts` sends a turn (`conversation`, `store: true`, `stream: true`, `truncation: 'auto'`).

- **What works:**
  - The API accepts it with `conversation`. The minimum threshold is 1,000 tokens.
  - Compaction items (`type: 'compaction'`) are stored in the conversation, and `items.list` returns them. Every earlier message stays listed, so history on reload is unaffected, and the history mapper already skips the new type.
  - The model kept facts across compaction, and a function call followed by its output carried on across one.
- **What blocks it as a default:**
  - Compaction counts against `max_output_tokens`. 3 of 11 compacting responses ended `incomplete`, and one held only a compaction item, with no answer and zero `usage`.
  - `usage` under-reports the compaction work, and our budgets rely on it.
  - At the sizes we could afford to test (1,000–2,000 tokens), input didn't shrink, and compaction then ran on every turn, adding 1.2–4.7 s per pass.
  - `file_search` answers came without citations in 3 of 3 turns (unconfirmed).
- **Decision (plan B):**
  - 0.2 keeps `truncation: 'auto'` and `limits.maxTurns`, and does not add `limits.compactAt`.
  - Compaction moves to 0.3, after a follow-up spike at a realistic threshold. It should check how many output tokens a 50k-token compaction takes, how billing compares with `usage`, and citations with and without compaction.
  - If compaction ships, its default threshold should be 50,000 tokens: far above the API minimum and well below every current model's context window and the 272k long-context price step.
  - The turn loop must then retry a step whose response holds only a compaction item.
