# ADR-0003: Conversation state without a database

- **Status:** Proposed. To be confirmed by spike S1 (`spikes/s1-openai/FINDINGS.md`).
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
- **Ownership without a database.** The resume token carries a signed conversation ID (HMAC). On top of that, the conversation object stores `metadata: { bot, visitor }` as defense in depth.
- **History on reload.** `conversations.items.list(conv, { order: 'asc' })` maps items to domain types and ignores unknown item types. Only user and assistant messages plus citations are shown; tool calls and reasoning stay hidden.
- **Dynamic context.** Page URL, identity and similar go into per-request `instructions`. They are never stored in the conversation.
- **Deletion.** `DELETE /conversations/:id` plus a "delete conversation" button removes the conversation and its uploaded files.
- **Own storage is an add-on.** Redis or Postgres (`@chatdock/store-postgres`, after 0.1) covers retention, export, ZDR/EU data residency and independence from OpenAI.

## Consequences and trade-offs (documented in the README)

1. **No automatic retention or admin browsing in core.** The API has no endpoint to list conversations, so conversations live until deleted.
2. **Data stays at OpenAI until deleted.** Conversations are not ZDR-eligible, and responses are also stored for 30 days.
3. **Long conversations get expensive.** They replay their full history as input, so we enforce turn limits, compaction and a stable prompt prefix for caching.
4. **Attachments after reload show only as a filename or placeholder.** Content of `user_data` files cannot be downloaded back.

## Open questions for spike S1

- Behaviour of a dangling `function_call` with no output, and whether repair with a synthetic `function_call_output` works.
- Behaviour of a conversation that references an expired or deleted file.
- Interplay of `store: false` with `conversation`.
- Latency of `items.list` and the item mapping.
- Image upload purpose: `vision` vs `user_data`.

**If S1 fails:** the default becomes our own store (Redis via an add-on), and this ADR is superseded.
