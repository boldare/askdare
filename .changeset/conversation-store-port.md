---
'@boldare/askdare': minor
---

Conversations now go through a `ConversationStore` port (ADR-0024). Nothing changes for apps that don't set it: the default, `openaiConversations()`, keeps conversations at OpenAI as before.

- `createChatHandler({ conversations })` chooses the store, on the server only. `openaiConversations({ apiKey? })` is exported from `@boldare/askdare/next`; without `apiKey` it reads `OPENAI_API_KEY`.
- `@boldare/askdare` exports the port and its types (`ConversationStore`, `ConversationOwner`, `ConversationInfo`, `ConversationContext`, `ConversationPage`, `ConversationStoreCheck`, `StoredItem`, `StoredPart`, `StoredCitation`, `PositionedItem`), `VersionConflictError`, and `memoryConversations()`, an in-memory store for tests and local development.
- The new subpath `@boldare/askdare/testing` exports the contract suites `conversationStoreContract` and `rateLimitStoreContract`. They take your test runner's `describe`, `it` and `expect`, so they work with Vitest or Jest.
- The server now checks that a resumed conversation belongs to the bot and the visitor named in the resume token, as the store records them. A conversation that doesn't is answered like one that no longer exists. With the default store this costs one extra request to OpenAI for each message in an existing conversation and each deletion; the history load makes it alongside its own. Conversations created by earlier versions keep working.
- New conversations at OpenAI carry the metadata `askdare_owner` (`visitor:<id>` or `user:<key>`) instead of `askdare_visitor`.
