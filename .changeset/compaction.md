---
'@boldare/askdare': minor
'@boldare/askdare-postgres': patch
---

`limits.compactAt` compacts long conversations kept in your own store, such as `@boldare/askdare-postgres` (ADR-0029). It is off unless you set it, between 20,000 and 272,000 tokens.

- Once a turn's last model call reads that many input tokens, askdare sends OpenAI one request after the turn, in the background, and stores the encrypted summary it returns with the conversation. The next turns replay from the summary instead of from the start, so they cost less and use less of the token budgets. In spike S9, 50 turns cost 27–56 % less, and three to four times fewer budget tokens.
- The visitor never waits for it. It reads the prompt cache the turn just wrote, is charged to the same budgets, and reaches `onUsage` as its own `compaction` entry (new type `ChatCompactionReport` in `@boldare/askdare/next`).
- Nothing stored is changed or removed: history, paging and deletion work as before. A visitor who writes again while it runs drops it, and a later turn tries again. When the summaries leave too large a floor, a conversation stops compacting.
- `openaiConversations()`, the default, never compacts. `createChatHandler` warns at startup when a bot sets `compactAt` with it.
- The `ConversationStore` port gains `kind: 'compaction'` on `native` items and a `model` option on `context()`, where the replay window starts at the latest compaction item (new type `CompactionModel`). `conversationStoreContract` tests it. A custom store that ignores the option still works, but reads the whole conversation on every turn.
- `@boldare/askdare-postgres`: `context()` starts at the latest compaction item, found in SQL. No migration.

See [Configuration](https://github.com/boldare/askdare/blob/main/docs/configuration.md#compaction), [Costs](https://github.com/boldare/askdare/blob/main/docs/costs.md#long-conversations-and-compaction) and [Privacy](https://github.com/boldare/askdare/blob/main/docs/privacy.md#with-your-own-conversation-store).
