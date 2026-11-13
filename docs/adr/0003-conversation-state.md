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

## Update (2026-11-12): compaction at a realistic threshold, spike S5b

[Spike S5b](../../spikes/s5b-compaction/README.md) tested compaction at the 50,000-token threshold proposed above, sent the way `turn.ts` sends a turn, on `gpt-6-luna` and `gpt-6.1-terra`, with a function tool, `file_search` and a control conversation without compaction. It cost about 1 USD.

- **How compaction behaves with `conversation`:**
  - It keeps the most recent ~60k tokens of history verbatim (whole items; between 59.3k and 67.7k) and summarises only what is older.
  - Below that size nothing can shrink. At 50k the input stayed at 50–63k, and every later response compacted again (31 compacting responses in 4 conversations).
  - Above it, the input does shrink: 101.7–206.9k fell to 34.6–59.3k on the next turn.
- **At 50k, compaction is harmful:**
  - Each compaction rewrites the context, so prompt caching is lost on every turn: the 7 turns after the threshold cost 12× (luna) and about 24× (terra) as much as the same turns without compaction.
  - It adds 1–9 s per response, once 113 s. Passes before the answer delay the first token to 6–10 s.
  - `file_search` answers after compaction had no file citations in 3 of 3 conversations, while the control cited. This confirms the S5 observation.
- **The S5 blockers, measured again:**
  - No response ended `incomplete` or held only a compaction item (0 of 31), but terra spent up to 765 output tokens on a compacting turn with a few-word answer, against the default `maxOutputTokens` of 1,024.
  - `usage` reported compaction as output (reasoning) tokens; no zero-usage response this time. Billing against the dashboard was not checked.
- **Facts above the retained window:** terra kept first-turn facts across a 100k compaction (1 of 1). Luna lost them in 3 of 3 runs at 100–200k.
- **Side finding:** `responses.inputTokens.count` with `conversation` locks that conversation (400 `conversation_locked`) for at least 75 s. The library must never count tokens against a live conversation.
- **Decision:**
  - Compaction waits. `limits.compactAt` (#52) is not part of 0.3.0-rc.1, and the 50,000 default above is withdrawn. 0.3 keeps `truncation: 'auto'` and `limits.maxTurns`.
  - Reconsider it for 0.4 at the earliest, as an opt-in with no default, once `file_search` keeps citations after compaction (or the stream mapper rebuilds them from `file_search_call.results`).
  - If it ships, it needs: a threshold validated between 100,000 and 272,000; +1,024 `max_output_tokens` headroom on requests that may compact, included in the budget reservation; compaction cost taken from `usage.output_tokens`; the S5 retry for compaction-only responses; and a note that the summary quality depends on the model.
