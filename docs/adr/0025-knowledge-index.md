# ADR-0025: Retrieval we own: the `KnowledgeIndex` port and the `search_knowledge` tool

- **Status:** Proposed
- **Date:** 2026-11-23
- **Evidence:** spike S8 ([findings](../../spikes/s8-retrieval/FINDINGS.md)); the Claude side of citations from S6a ([findings](../../spikes/s6-claude/FINDINGS.md), Q4); the Open Responses side from S6b ([findings](../../spikes/s6b-open-responses/FINDINGS.md), section 2).

## Context

Knowledge today is an OpenAI vector store: `askdare kb sync` uploads a folder, and turns use the hosted `file_search` tool. That keeps documents, chunks and embeddings at OpenAI, costs $2.50 per 1,000 searches, and exists on no other provider.

Spike S8 built the alternative on Postgres with pgvector and answered the same 27 questions as `file_search` on two models: 27 of 27 on every arm, every citation correct, no invented sources, the planted prompt injection ignored. The own path was 1.4–1.9× faster and, on the small model, $0.00013 per answer against $0.00276. The fixtures are at the ceiling, so this shows parity, not a margin.

## Decision

1. **The port** (S8's `port.ts`, names final in the implementing task), server-side only (ADR-0004: the client never picks an index):
   - **`KnowledgeIndex`:** `sync(documents)`, `search(query, { maxResults })`, `passage(sourceId)`, `clear()` and `diagnose()`. One database holds many bots' indexes, each under its own index ID.
   - **`Embedder`:** separate from the index, so the site picks the key and the model. Its `id` (provider, model and dimensions) is stored with the index. A different ID makes the next sync re-embed everything, and makes `diagnose` fail until it has.
   - **Documents arrive chunked.** `KnowledgeDocument` carries its path, file hash, title, URL and chunks (section trail, text and hash). Core does the chunking, so every index chunks the same way and an add-on stays small: heading-aware, within one section, tables whole when they fit, at most about 350 tokens.
2. **Retrieval is a function tool,** `search_knowledge`, strict, with one `query` argument. The model writes the query and may search again within the bot's step limit. It works on every model path; a hosted `file_search` exists only at OpenAI. On the last step `tool_choice: 'none'` applies as to other tools. The name is reserved by `defineBot`, as `file_search` and `suggest_replies` are (ADR-0006, ADR-0015).
3. **Configuration:** `defineBot({ knowledge: { index, maxResults? } })` next to today's `knowledge: { vectorStoreId }`. A bot has one or the other.
   - **The default stays OpenAI vector stores** with hosted `file_search` on the OpenAI path. Sites without a database keep working; a site moves when it wants to own its data.
   - **`pgvectorIndex({ … })`** ships in `@boldare/askdare-postgres` ([ADR-0024](0024-conversation-store.md)), with `pg` as its only dependency.
   - **`openaiEmbedder({ model, dimensions })`** ships in core (it lives in `src/openai/`). The model is required: the library names no model IDs. It is the OpenAI key the site already has, on any model path.
4. **Search:** hybrid, vector (HNSW) plus Postgres full text with the language-neutral `simple` configuration, fused by reciprocal rank with a text weight of 0.3. Results come with a score and stay in the order the fusion gives. A per-index full-text language is not in 0.6.
5. **Citations keep the protocol:**
   - Results reach the model with their **source IDs**, and the instructions ask it to write `[id]` after a statement.
   - The stream mapper rewrites the IDs into today's `[n]` markers while streaming and emits one `citation { index, title, url? }` per new source. It holds back up to 48 characters of an unclosed `[`, passes other brackets and Markdown links through, merges adjacent identical markers, and drops IDs it can't resolve (counted, never logged with content).
   - **Source IDs are stable across turns:** `k` followed by the first 12 hex characters of the chunk's hash. Earlier turns' results stay in the model's context, so a per-turn `k1, k2…` registry would map a later citation to the wrong passage. Any ID resolves through `passage()`, with one indexed lookup and no state per turn; a chunk removed by a later sync stops resolving and its marker is dropped. `sync` refuses an ID that two different chunks of one index would share.
   - **Stored history:** item stores keep the citations on the text part (ADR-0024). With `openaiConversations()`, history rewrites the stored `[id]` markers on reload through `passage()`.
   - **Claude** (later, [ADR-0026](0026-provider-path.md)): each passage goes in as a `search_result` block with `source` = the source ID, never the page URL. Documents without a URL still cite, and two chunks of one page stay apart.
6. **Retrieved text is always untrusted:** results reach the model inside ADR-0019's wrapper (`{"untrusted_tool_result": …}`, JSON-encoded so no document can close it), whatever the bot's `toolResults` setting, and the matching rule joins the instructions whenever the bot has an index.
7. **Sync stays in the CLI.** `askdare kb sync` keeps its folder, front matter, `askdare.kb.json` and hashes, and gains an index target next to the vector store:
   - two-level hashes: an unchanged file is skipped, and a changed file re-embeds only its changed chunks; a renamed file re-embeds nothing;
   - each document is written in one transaction, so a search never sees half a document;
   - the CLI builds the index with the add-on's own `pgvectorIndex` and `openaiEmbedder`, from environment variables. The library still never reads the file system at runtime.
   - The folder stays the source of truth, and `sync` is idempotent, although the index keeps its state in the database.
8. **Formats on the own path in 0.6:** Markdown, MDX, plain text and HTML. Other files are skipped with a warning. PDF, DOCX and PPTX come later, built in or through an extractor the site supplies; until then the vector-store path still takes them.
9. **`doctor`** gains `knowledge.pgvector` (extension present, and its version), `knowledge.synced` (the index exists and isn't empty) and `knowledge.embedder` (the index's embedder matches the bot's), plus whether the database is reachable.
10. **Not in 0.6:** searching before the turn without a tool (cheaper, but it searches with the visitor's raw words and puts results in the user message), an in-process index for small static sites, and first-party adapters for hosted vector databases. The port is small enough for a community adapter.
11. **Evaluation:** S8's `questions.json` and grading rules seed `askdare eval` (0.8), with a harder set first: 100 or more documents, cross-language questions, multi-turn follow-ups and PDFs.
12. **Public surface** (added to ADR-0006 when this is accepted): `knowledge.index` and `knowledge.maxResults` in `defineBot`; the `KnowledgeIndex` and `Embedder` ports with `KnowledgeDocument`, `KnowledgeChunk`, `Passage` and `SyncReport`; `openaiEmbedder`; the reserved tool name `search_knowledge`; the knowledge index suite in `@boldare/askdare/testing`; `pgvectorIndex` in `@boldare/askdare-postgres`; and the index target of `askdare kb sync`.

## Consequences

- Documents, chunks and embeddings can live in the site's own database, and knowledge works the same on every model path.
- Answers on the own path cost about a twentieth on a small model, since there is no per-search fee and chunks are smaller. Embedding cost is negligible: about $0.016 for a 1,000-page site.
- Text extraction becomes our job, and PDFs wait on the own path.
- Each answer that searches costs two model calls (search, then answer). S8 still measured it faster end to end than `file_search`.
- Not yet tested: 12-character source IDs instead of S8's `k1`, and citations of a passage from an earlier turn. The implementing task reruns S8's evaluation with both before this ADR is accepted.
- Search quality is proven only on 11 documents in one language.

## Alternatives considered

- **Search before the turn, no tool:** fastest and cheapest in S8, but a follow-up like "and on Business?" searches badly, and results ride in the user message, a weaker channel for untrusted text. It may come later as an option for single-question bots.
- **Per-turn source IDs (`k1`, `k2`…):** shorter for the model to copy, but wrong once history carries earlier results.
- **The page URL as Claude's `source`:** what S6a used. It merges chunks of one page and fails for documents without a URL.
- **An in-process index** emitted by `kb sync` as a module: fast enough to about 10,000 chunks, but every content change becomes a redeploy, and serverless pays for it on each cold start.
- **Full text weighted equally with vectors:** the noisier `simple` configuration pushed a right chunk out of the top 5. Vectors alone scored best on S8's questions but miss exact terms such as header and product names.
