---
'@boldare/askdare': minor
'@boldare/askdare-postgres': patch
---

A bot can answer from its own knowledge index (ADR-0025): `defineBot({ knowledge: { index, maxResults? } })`, next to `knowledge: { vectorStoreId }`. A bot has one or the other; bots with a vector store work as before.

- **The `search_knowledge` tool.** With an index, the model searches it through a built-in, strict function tool with one argument, the query, within the bot's step limit. The name is reserved: `defineBot` refuses a tool called `search_knowledge`. The widget shows "Searching…" while it runs, as for file search.
- **Citations look the same as file search's.** Results reach the model with source IDs, and the model cites them as `[k0123456789ab]`. While the answer streams, askdare rewrites them into the usual `[n]` markers and `citation` events, with the document's title and http(s) link only. IDs are stable across turns, so a passage found in an earlier turn is looked up in the index and still cites. Made-up or removed IDs are dropped and counted in a warning, never logged with text. No protocol change.
- **Untrusted results.** Search results always reach the model inside the untrusted wrapper (ADR-0019), whatever `toolResults` says, and the retrieval rule joins the instructions.
- **History.** Item stores keep the citations with the answer's text, so a reload shows the same markers. With `openaiConversations()`, history looks the stored markers up in the index.
- **`askdare doctor`** reports the index's checks: the database, pgvector, whether it is synced, and whether its embedder matches the bot's.

New exports:

- `@boldare/askdare`: `openaiEmbedder` (with `OpenAIEmbedderOptions`); the knowledge port types `KnowledgeIndex`, `Embedder`, `Embeddings`, `KnowledgeDocument`, `KnowledgeChunk`, `Passage`, `SyncReport`, `SearchOptions`, `KnowledgeCallOptions` and `KnowledgeCheck`; and, for index adapters, `checkKnowledgeDocuments` and `embeddingInput`. `KnowledgeConfig` is now a union of the two shapes.
- `@boldare/askdare/testing`: `knowledgeIndexContract(name, open, { describe, it, expect, dimensions? })`, with `OpenKnowledgeIndex` and `KnowledgeIndexContractOptions`, and the fixtures `fakeEmbedder` and `knowledgeDocument`. `ContractExpect` now also needs `toHaveLength` and `toBeGreaterThan`, which Vitest's and Jest's `expect` have.

`@boldare/askdare-postgres` imports the port and the adapter helpers from `@boldare/askdare` instead of bundling copies, so it needs the `@boldare/askdare` version that exports them.
