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
- **Ownership without a database.** The resume token carries a signed conversation ID (HMAC). On top of that, the conversation object stores `metadata: { bot, visitor }` as defense in depth.
- **History on reload.** `conversations.items.list(conv, { order: 'asc' })` maps items to domain types and ignores unknown item types. Only user and assistant messages plus citations are shown; tool calls and reasoning stay hidden.
- **Dynamic context.** Page URL, identity and similar go into per-request `instructions`. They are never stored in the conversation.
- **Deletion.** `DELETE /conversations/:id` plus a "delete conversation" button removes the conversation and its uploaded files.
- **Own storage is an add-on.** Redis or Postgres (`@boldare/askdare-store-postgres`, after 0.1) covers retention, export, ZDR/EU data residency and independence from OpenAI.

## Consequences and trade-offs (documented in the README)

1. **No automatic retention or admin browsing in core.** The API has no endpoint to list conversations, so conversations live until deleted.
2. **Data stays at OpenAI until deleted.** Conversations are not ZDR-eligible, and responses are also stored for 30 days.
3. **Long conversations get expensive.** They replay their full history as input, so we enforce turn limits, compaction and a stable prompt prefix for caching.
4. **Attachments after reload show only as a filename or placeholder.** Content of `user_data` files cannot be downloaded back.

## Evidence (spike S1, live API, 2026-10-29)

- **Streaming:** turns inside a conversation stream normally. Time to first token was 0.9–1.3 s on `gpt-6.1-terra`.
- **Function calls:** a dangling call breaks the next turn with a 400. A synthetic `function_call_output` repairs it, so the step 3.2 tool loop must answer every call.
- **Attachments:** deleting or expiring a file does not break the conversation. Images and PDFs both work with purpose `user_data`.
- **`store: false`** with a conversation silently drops the turn. **Always send `store: true`.**
- **`items.list`:** about 1.9 s, with descending default order. Load history once, with `order: 'asc'`, and show a loading state.
- **Errors:** a deleted conversation gives a 404 that mentions the conversation; an unknown model gives a 404 with `model_not_found`. The two are mapped differently (`not_found` vs `bot_unavailable`).
