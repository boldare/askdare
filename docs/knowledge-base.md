# Knowledge base

A bot can answer from your own documents. askdare uploads them to an OpenAI vector store, the model searches it with OpenAI file search, and each answer cites its sources as links to your pages.

To keep the documents, their chunks and their embeddings in your own Postgres instead, sync the same folder to your own index, and the model searches it with the `search_knowledge` tool: see [Your own index](#your-own-index). Visitors see the same citations either way.

## 1. Prepare a folder

Put the documents in one folder, for example `knowledge/`. Supported: `.md`, `.mdx`, `.txt`, `.pdf`, `.docx`, `.pptx`, `.html`, `.htm`, `.json`. Other files and hidden files are skipped.

Give each document a title and the public URL that citations should link to:

- Markdown: front matter.

  ```md
  ---
  title: Pricing and plans
  url: https://www.example.com/pricing
  ---
  ```

- Any file, for example a PDF: `askdare.kb.json` in the folder root, keyed by path inside the folder.

  ```json
  {
    "guides/handbook.pdf": { "title": "Customer handbook", "url": "https://www.example.com/handbook" }
  }
  ```

Without a title the file name is used. Without a URL the citation is shown as plain text. URLs must be `http(s)`, up to 512 characters.

## 2. Sync

```bash
npx @boldare/askdare kb sync knowledge
```

- Reads `OPENAI_API_KEY` from the environment, `.env.local` or `.env` (or `--env-file <path>`).
- The first run creates a vector store and prints its ID. Save it as `KB_VECTOR_STORE_ID`.
- Later runs pass the store through `KB_VECTOR_STORE_ID` or `--store vs_…` and change only what changed: new and edited files are uploaded, removed files are deleted, a new title or URL only updates the file's attributes. A second run without changes does nothing.
- `--dry-run` shows the plan without changing anything.

The store is the source of truth: every file carries its path, content hash, title and URL as attributes, so no state is kept locally and the command can run from CI. Files in the store that askdare did not upload are left alone.

Vector stores belong to an OpenAI project. Use one store per environment (development, staging, production), each with its own `KB_VECTOR_STORE_ID`.

## 3. Connect the bot

```ts
defineBot({
  // …
  knowledge: process.env.KB_VECTOR_STORE_ID
    ? { vectorStoreId: process.env.KB_VECTOR_STORE_ID, maxResults: 5 }
    : undefined,
});
```

`maxResults` (1–50, default 5) is how many chunks the model reads per search. More grounds answers better but costs more input tokens; the turn's budget reservation grows with it.

Tell the model in `instructions` when to use the documents, for example "Answer questions about our products only from the documents you can search, and cite them."

## Costs and limits

- File search is billed per call, and the retrieved chunks count as input tokens. Vector store storage is billed per GB per day above the free tier. See OpenAI pricing.
- The tool names `file_search` and `search_knowledge` are reserved; your own tools cannot use them.

## Your own index

### Sync

`kb sync --index <id>` mirrors the same folder, with the same front matter and `askdare.kb.json`, into a knowledge index in your own Postgres (`pgvectorIndex` from `@boldare/askdare-postgres`) instead of a vector store. The documents, chunks and embeddings are stored in your database; OpenAI computes the embeddings, with your key, and stores nothing for the index.

```bash
npm install @boldare/askdare-postgres
npx askdare-postgres migrate
npx @boldare/askdare kb sync knowledge --index support
```

With, in `.env.local` or the environment:

```bash
OPENAI_API_KEY=sk-…
DATABASE_URL=postgres://…
ASKDARE_EMBEDDING_MODEL=<an OpenAI embedding model>
ASKDARE_EMBEDDING_DIMENSIONS=1536
```

- **Formats:** `.md`, `.markdown`, `.mdx`, `.txt`, `.html` and `.htm`. PDFs, Word, PowerPoint and `.json` are skipped with a warning; keep those in a vector store for now.
- **Incremental:** documents are chunked by section, and only chunks the index doesn't have are embedded. An edited paragraph re-embeds that chunk; a renamed file with a title from front matter or the manifest re-embeds nothing. The report says what was added, changed, removed and unchanged, and how many chunks and tokens were embedded or reused.
- **The embedding model:** required, with no default. Use the same model and size for the bot's `openaiEmbedder` as for `kb sync`; changing either makes the next sync embed everything again.
- **Many bots, one database:** each bot has its own index ID, usually the bot's ID.
- **Database user:** run the first sync of an index as the user that ran `migrate`; it creates the index's vector index.
- `--dry-run` shows the documents and chunk counts without a database or a key.

The options are in [Command line](cli.md#to-your-own-index).

### Connect the bot

```ts
import { defineBot, openaiEmbedder } from '@boldare/askdare';
import { pgvectorIndex } from '@boldare/askdare-postgres';

const embedder = openaiEmbedder({
  model: process.env.ASKDARE_EMBEDDING_MODEL ?? '',
  dimensions: Number(process.env.ASKDARE_EMBEDDING_DIMENSIONS),
});

defineBot({
  id: 'support',
  // …
  knowledge: {
    // Reads DATABASE_URL; use the index ID you sync with.
    index: pgvectorIndex({ embedder, indexId: 'support' }),
    maxResults: 5,
  },
});
```

A bot has either `vectorStoreId` or `index`, not both. `maxResults` (1–50, default 5) is how many passages the model reads per search. `openaiEmbedder` throws when the model or size is missing, so set `ASKDARE_EMBEDDING_MODEL` and `ASKDARE_EMBEDDING_DIMENSIONS` wherever the app builds or runs, as you do `ASKDARE_MODEL`. [Own your data](own-your-data.md) walks through the whole move, with conversations.

- **The tool.** The bot gets a built-in `search_knowledge` tool with one argument, the query, which the model writes. It may search again within the bot's `limits.maxSteps`; on the last step it must answer. The widget shows "Searching…" as for file search.
- **Citations.** Results reach the model with source IDs such as `k0123456789ab`, and askdare tells it to cite them in square brackets. While the answer streams, askdare turns them into the same numbered markers and source links that file search answers have. IDs stay the same across turns, so the model can cite a passage it found earlier in the conversation. An ID that resolves to nothing, because the model made it up or a later sync removed the passage, is dropped from the answer.
- **Untrusted text.** Results are always wrapped as untrusted data, whatever `toolResults` says, and askdare adds the rule to the instructions: the model uses them to answer but doesn't follow instructions written in your documents ([guardrails](guardrails.md)).
- **History.** With an item store such as `postgresConversations()`, the citations are stored with the answer. With `openaiConversations()`, the markers are looked up in the index again when the history loads, so a passage removed since then loses its marker. `onTranscript` gets the answer as it streamed, with `[n]` markers and their citations, with either store. Reading `openaiConversations().page()` yourself gives the model's raw IDs with no citations, since the store serves every bot and doesn't know their indexes; look them up with the bot's index's `passage()`.
- **Doctor.** `askdare doctor` reports the index's checks: whether the database answers, the pgvector version, whether the index was synced, and whether it was synced with the bot's embedder.
- **Costs.** No per-search fee: each search is one embedding request for the query and one database query. An answer that searches takes two model calls, search and answer.

To use another database, implement the `KnowledgeIndex` port and run `knowledgeIndexContract` from `@boldare/askdare/testing` against it.

Try it in the demo site: `pnpm --dir site kb:sync` uploads the sample documents in `site/knowledge/`.
