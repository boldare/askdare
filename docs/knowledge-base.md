# Knowledge base

A bot can answer from your own documents. askdare uploads them to an OpenAI vector store, the model searches it with OpenAI file search, and each answer cites its sources as links to your pages.

To keep the documents, their chunks and their embeddings in your own Postgres instead, sync the same folder to your own index: see [Syncing to your own index](#syncing-to-your-own-index).

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
- The tool name `file_search` is reserved; your own tools cannot use it.

## Syncing to your own index

`kb sync --index <id>` mirrors the same folder, with the same front matter and `askdare.kb.json`, into a knowledge index in your own Postgres (`pgvectorIndex` from `@boldare/askdare-postgres`) instead of a vector store. The documents, chunks and embeddings are stored in your database; OpenAI computes the embeddings, with your key, and stores nothing for the index.

```bash
npm install @boldare/askdare-postgres
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
- `--dry-run` shows the documents and chunk counts without a database or a key.

The options are in [Command line](cli.md#to-your-own-index).

Try it in the demo site: `pnpm --dir site kb:sync` uploads the sample documents in `site/knowledge/`.
