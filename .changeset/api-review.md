---
'@boldare/askdare': minor
---

Fixes from the review of 0.6's public API:

- **`askdare doctor`** creates and deletes a test conversation at OpenAI only for apps whose conversations OpenAI keeps: the check is now `openaiConversations().diagnose()`, run once per app instead of once per bot. With a store that keeps the items, such as `postgresConversations()`, nothing of yours calls the Conversations API, which isn't eligible for Zero Data Retention.
- **Signing in or out while an answer streams** (`askdare('identify')`, or `Root`'s `identity`) now stops that answer in the chat, as stopping the chat does. The server still finishes it in the previous person's conversation. Before, the rest of the answer appeared in the next person's chat (from their own history, so nothing crossed between users).
- **The widget is about 3 KB smaller** (gzipped): its iframe app now ships only marked's lexer, as `@boldare/askdare/react` does since this release.
