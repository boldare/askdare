---
'@boldare/askdare': minor
---

`askdare kb sync` can now sync a knowledge folder into your own index in Postgres instead of an OpenAI vector store (ADR-0025). `kb sync <folder> --index <id>` builds `pgvectorIndex` from `@boldare/askdare-postgres` (install it in the app) with `DATABASE_URL`, and embeds with OpenAI using `OPENAI_API_KEY`.

- The embedding model and vector size are required: `--embedding-model` and `--dimensions`, or `ASKDARE_EMBEDDING_MODEL` and `ASKDARE_EMBEDDING_DIMENSIONS`. There is no default model. Use the same ones as the bot's `openaiEmbedder`; another model or size makes the next sync embed everything again.
- The sync is incremental. An unchanged file is skipped, an edited file re-embeds only its changed chunks, and a renamed file with a title from front matter or `askdare.kb.json` re-embeds nothing. The report lists added, changed, removed and unchanged documents, and the chunks and tokens embedded or reused.
- The index reads `.md`, `.markdown`, `.mdx`, `.txt`, `.html` and `.htm`. Other files, PDFs and `.json` included, are skipped with a warning. The vector-store path still takes them.
- `--dry-run --index` reads and chunks the folder without a database or a key.

The vector-store path is unchanged, except that it now reads front matter with the same parser as the index. A closing `---` must now end its line.
