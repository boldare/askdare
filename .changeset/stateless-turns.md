---
'@boldare/askdare': minor
---

Conversation stores that keep the items themselves now work: `createChatHandler({ conversations: memoryConversations() })` no longer refuses one, and `@boldare/askdare-postgres` will plug in the same way (ADR-0024).

- With such an item store, each turn replays the stored conversation to OpenAI with `store: false` and appends everything it produces to your store. Nothing of the conversation stays at OpenAI beyond its 30-day abuse monitoring of requests, so organisations with Zero Data Retention can use askdare. Attached files are still uploaded to OpenAI.
- Requests are larger, since they carry the whole conversation, the model's encrypted reasoning included; spike S7 measured the same cost, as the replay is read from the prompt cache. Reasoning is replayed only to the model family that wrote it.
- A crash loses at most the model call in flight, and never leaves a tool call without its output. Of two turns started on the same conversation at once, one ends with `rate_limited` ("The previous answer in this conversation is still on its way").
- History (`POST /history`) reads item stores too, with citations, reply options and tool cards. Answers are rated by their ID in your store.
- The default, `openaiConversations()`, works as before.
