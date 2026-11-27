# @boldare/askdare-postgres

## 0.1.1

### Patch Changes

- 09f6261: `migrate` adds a partial index on compaction items (conversations schema version 2), so `context()` finds a conversation's latest compaction item without reading all its items. Run `npx askdare-postgres migrate` when you upgrade: until then `doctor` reports the schema as behind, and the store keeps working without the index. The build blocks appends for about a tenth of a second per million items; on a very large table, build it beforehand with `create index concurrently` ([custom stores](https://askdare.vercel.app/docs/custom-store#the-compaction-lookup)).
- Updated dependencies [e2a87b5]
- Updated dependencies [31e982f]
- Updated dependencies [1a451cb]
- Updated dependencies [8913670]
  - @boldare/askdare@0.6.1

## 0.1.0

### Minor Changes

- 955a103: `pgvectorIndex({ embedder })` keeps a bot's knowledge in your own Postgres with pgvector (ADR-0025). It implements the `KnowledgeIndex` port of `@boldare/askdare`: `defineBot({ knowledge: { index } })` takes it, and `askdare kb sync` fills it.
  
  - **Search:** hybrid. Vector search (an HNSW index per knowledge index) and full text in the language-neutral `simple` configuration are fused by reciprocal rank, with the full-text ranking weighted 0.3. On the evaluation set of spike S8 it found the right document in the top 5 for 23 of 23 questions.
  - **Sync:** incremental. An unchanged file is skipped, a changed file re-embeds only the chunks that changed, and a renamed file re-embeds nothing. Each document is written in one transaction. A different embedder (another model or size) makes the next sync embed everything again.
  - **Many bots, one database:** every row carries its index ID (`indexId`, default `default`). Embedders of any size share the tables.
  - **`diagnose()`** reports whether the database answers (`knowledge.reachable`), the pgvector version (`knowledge.pgvector`), the schema (`knowledge.schema`), whether the index is synced (`knowledge.synced`) and whether its embedder matches (`knowledge.embedder`).
  
  `migrate()` now creates the `knowledge` part of the schema: the `vector` extension and three tables named `askdare_knowledge_*`. On a database without pgvector, migrate only the parts you use: `migrate({ parts: ['conversations'] })` or `npx askdare-postgres migrate conversations`. The first `kb sync` of an index creates its HNSW index, so it needs the database user that owns the tables, the one that migrates.
- 8ea590b: New: `postgresConversations()`, a conversation store that keeps conversations in your own Postgres. Pass it to `createChatHandler({ conversations })`; turns then replay the stored history with `store: false`, so OpenAI keeps no copy of the conversation (only its abuse-monitoring logs of requests, which Zero Data Retention turns off; attached files are still uploaded to OpenAI). See [Own your data: what stays at OpenAI](https://github.com/boldare/askdare/blob/main/docs/own-your-data.md#what-stays-at-openai). It reads `DATABASE_URL` (or takes `url` or `pool`), connects on first use, and passes the same contract suite as the built-in stores.
  
  - Run `npx askdare-postgres migrate` before deploying: it now creates the `askdare_conversations` and `askdare_conversation_items` tables. The store never changes the schema itself, and `askdare doctor` reports when it needs `migrate`.
  - `sweep(idleSince, limit, signal?)` deletes conversations idle since a time and returns their IDs and attached file IDs, for a retention period you choose. Call it from a cron route (Vercel) or a scheduled job (Heroku); the README shows both.
- 03a1d37: New add-on, `@boldare/askdare-postgres`, for keeping askdare's data in your own Postgres. `migrate()` and the `askdare-postgres migrate` command create or upgrade its schema from `DATABASE_URL` (or a `url` or `pool` you pass), idempotently and never at request time. It holds a conversation store (`postgresConversations`) and a pgvector knowledge index (`pgvectorIndex`). See [Own your data](https://github.com/boldare/askdare/blob/main/docs/own-your-data.md).

### Patch Changes

- 5a837ba: `limits.compactAt` compacts long conversations kept in your own store, such as `@boldare/askdare-postgres` (ADR-0029). It is off unless you set it, between 20,000 and 272,000 tokens.
  
  - Once a turn's last model call reads that many input tokens, askdare sends OpenAI one request after the turn, in the background, and stores the encrypted summary it returns with the conversation. The next turns replay from the summary instead of from the start, so they cost less and use less of the token budgets. In spike S9, 50 turns cost 27–56 % less, and three to four times fewer budget tokens.
  - The visitor never waits for it. It reads the prompt cache the turn just wrote, is charged to the same budgets, and reaches `onUsage` as its own `compaction` entry (new type `ChatCompactionReport` in `@boldare/askdare/next`).
  - Nothing stored is changed or removed: history, paging and deletion work as before. A visitor who writes again while it runs drops it, and a later turn tries again. When the summaries leave too large a floor, a conversation stops compacting.
  - `openaiConversations()`, the default, never compacts. `createChatHandler` warns at startup when a bot sets `compactAt` with it.
  - The `ConversationStore` port gains `kind: 'compaction'` on `native` items and a `model` option on `context()`, where the replay window starts at the latest compaction item (new type `CompactionModel`). `conversationStoreContract` tests it. A custom store that ignores the option still works, but reads the whole conversation on every turn.
  - `@boldare/askdare-postgres`: `context()` starts at the latest compaction item, found in SQL. No migration.
  
  See [Configuration](https://github.com/boldare/askdare/blob/main/docs/configuration.md#compaction), [Costs](https://github.com/boldare/askdare/blob/main/docs/costs.md#long-conversations-and-compaction) and [Privacy](https://github.com/boldare/askdare/blob/main/docs/privacy.md#with-your-own-conversation-store).
- e903330: A bot can answer from its own knowledge index (ADR-0025): `defineBot({ knowledge: { index, maxResults? } })`, next to `knowledge: { vectorStoreId }`. A bot has one or the other; bots with a vector store work as before.
  
  - **The `search_knowledge` tool.** With an index, the model searches it through a built-in, strict function tool with one argument, the query, within the bot's step limit. The name is reserved: `defineBot` refuses a tool called `search_knowledge`. The widget shows "Searching…" while it runs, as for file search.
  - **Citations look the same as file search's.** Results reach the model with source IDs, and the model cites them as `[k0123456789ab]`. While the answer streams, askdare rewrites them into the usual `[n]` markers and `citation` events, with the document's title and http(s) link only. IDs are stable across turns, so a passage found in an earlier turn is looked up in the index and still cites. Made-up or removed IDs are dropped and counted in a warning, never logged with text. No protocol change.
  - **Untrusted results.** Search results always reach the model inside the untrusted wrapper (ADR-0019), whatever `toolResults` says, and the retrieval rule joins the instructions.
  - **History.** Item stores keep the citations with the answer's text, so a reload shows the same markers. With `openaiConversations()`, history looks the stored markers up in the index.
  - **`askdare doctor`** reports the index's checks: the database, pgvector, whether it is synced, and whether its embedder matches the bot's.
  
  New exports:
  
  - `@boldare/askdare`: `openaiEmbedder` (with `OpenAIEmbedderOptions`); the knowledge port types `KnowledgeIndex`, `Embedder`, `Embeddings`, `KnowledgeDocument`, `KnowledgeChunk`, `Passage`, `SyncReport`, `SearchOptions`, `KnowledgeCallOptions` and `KnowledgeCheck`; and, for index adapters, `checkKnowledgeDocuments` and `embeddingInput`. `KnowledgeConfig` is now a union of the two shapes.
  - `@boldare/askdare/testing`: `knowledgeIndexContract(name, open, { describe, it, expect, dimensions? })`, with `OpenKnowledgeIndex` and `KnowledgeIndexContractOptions`, and the fixtures `fakeEmbedder` and `knowledgeDocument`. `ContractExpect` now also needs `toHaveLength` and `toBeGreaterThan`, which Vitest's and Jest's `expect` have.
  
  `@boldare/askdare-postgres` imports the port and the adapter helpers from `@boldare/askdare` instead of bundling copies, so it needs the `@boldare/askdare` version that exports them.
- Updated dependencies [6580516]
- Updated dependencies [5a837ba]
- Updated dependencies [c8e4269]
- Updated dependencies [225577a]
- Updated dependencies [87c0d04]
- Updated dependencies [e2386f1]
- Updated dependencies [64af8bb]
- Updated dependencies [ff7c762]
- Updated dependencies [e903330]
- Updated dependencies [1107680]
- Updated dependencies [94ed842]
  - @boldare/askdare@0.6.0
