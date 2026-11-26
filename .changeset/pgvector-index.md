---
'@boldare/askdare-postgres': minor
---

`pgvectorIndex({ embedder })` keeps a bot's knowledge in your own Postgres with pgvector (ADR-0025). It implements the `KnowledgeIndex` port of `@boldare/askdare`: `defineBot({ knowledge: { index } })` takes it, and `askdare kb sync` fills it.

- **Search:** hybrid. Vector search (an HNSW index per knowledge index) and full text in the language-neutral `simple` configuration are fused by reciprocal rank, with the full-text ranking weighted 0.3. On the evaluation set of spike S8 it found the right document in the top 5 for 23 of 23 questions.
- **Sync:** incremental. An unchanged file is skipped, a changed file re-embeds only the chunks that changed, and a renamed file re-embeds nothing. Each document is written in one transaction. A different embedder (another model or size) makes the next sync embed everything again.
- **Many bots, one database:** every row carries its index ID (`indexId`, default `default`). Embedders of any size share the tables.
- **`diagnose()`** reports whether the database answers (`knowledge.reachable`), the pgvector version (`knowledge.pgvector`), the schema (`knowledge.schema`), whether the index is synced (`knowledge.synced`) and whether its embedder matches (`knowledge.embedder`).

`migrate()` now creates the `knowledge` part of the schema: the `vector` extension and three tables named `askdare_knowledge_*`. On a database without pgvector, migrate only the parts you use: `migrate({ parts: ['conversations'] })` or `npx askdare-postgres migrate conversations`. The first `kb sync` of an index creates its HNSW index, so it needs the database user that owns the tables, the one that migrates.
