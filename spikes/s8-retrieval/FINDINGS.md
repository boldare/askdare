# Spike S8: retrieval outside OpenAI vector stores

- **Date:** 2026-11-23. **Task:** `tasks/0.6-s8-retrieval.md`. **Feeds:** the retrieval ADR that task P1 writes.
- **Setup:** Postgres 17 with pgvector 0.8.7 in Docker (host port 54328), `pg` 8.23.1, `openai` 7.62.0, Node 22.21.
- **Models** (named only in this spike): embeddings `text-embedding-3-small` at 1536 dimensions; answers `gpt-6-luna` and `gpt-6.1-terra`, both with `reasoning.effort: 'low'`; `gpt-6-luna` as the judge for questions the documents can't answer.
- **Prices** (developers.openai.com/api/docs/pricing, 2026-11-21): embeddings $0.02 per 1M tokens; file_search $2.50 per 1,000 calls; vector store storage $0.10 per GB per day, first GB free; luna $0.10 in / $0.50 out, terra $1 in / $5 out per 1M tokens.

## Verdict: **go**

Own retrieval on pgvector answered as well as `file_search` on every question, with every citation correct and no invented sources. It was faster and cheaper per answer, and it works the same for OpenAI, Claude and Open Responses. Three conditions:

1. **Keep OpenAI vector stores as the default adapter** behind the same port. Sites without a database keep working, and a site moves when it wants to own its data.
2. **Text extraction becomes our job.** `file_search` parses PDF, DOCX and PPTX today; this spike only did Markdown, text and HTML. The ADR has to decide which formats the own path supports in 0.6 (suggestion: Markdown, MDX, text and HTML; PDF later, or through a user-supplied extractor).
3. **Build a harder eval set before 0.8.** Every arm scored 27/27 on these fixtures, so they show parity, not a margin (see Quality).

## What ran

| File | What it does |
| --- | --- |
| `port.ts` | The proposed port, with no OpenAI or Postgres types |
| `scan.ts` | Reads the folder the way `kb sync` does (same front matter, `askdare.kb.json`, sha256), plus text extraction |
| `chunk.ts` | Heading-aware chunking |
| `pg-index.ts` | pgvector adapter: incremental sync, hybrid search, `diagnose` |
| `citations.ts` | Passage ids, streaming `[kN]` → `[n]` rewriting, the untrusted wrapper, the Claude mapping |
| `sync.ts` | Q2 measurements (`pnpm sync`) |
| `eval.ts` | Q3: search only (`--retrieval`), or answers from three arms (`--models …`) |
| `questions.json` | 27 questions with expected sources and facts, reusable for `askdare eval` |
| `test-markers.ts`, `test-offline.ts` | Offline checks: the marker rewriter, and sync and search with a fake embedder |
| `bench-inprocess.ts` | Q6: brute-force search in process |
| `results-*.json` | Raw results, every answer included |

**Fixtures:** the three `site/knowledge` documents plus eight new fictional Brightloop documents (`fixtures/knowledge/`): about 1,700 words in Markdown, a `.txt` with its title from `askdare.kb.json`, and an HTML page. They include deliberate traps:

- `release-notes.md` repeats and dates the Team price, so a question about the price is pulled two ways;
- `community-faq.md` contains a prompt injection that offers a promo code and asks users to email their password.

Nothing in them is real, so nothing needed redacting.

## Question 1: the port

Three parts, all server-side (ADR-0004: the client never picks an index):

- **`KnowledgeIndex`:** `sync(documents)`, `search(query, { maxResults })`, `clear()` and `diagnose()`. One database holds many bots' indexes; each row carries an `index_id`.
- **`Embedder`:** separate from the index, so the site chooses the key and model. Its `id` (`openai:text-embedding-3-small:1536`) is stored with the index. A different id makes the next sync re-embed everything, and makes `diagnose` fail until it runs.
- **Scanning and extraction** stay in the CLI (`askdare kb sync`). The library still never reads the file system at runtime.

**What a turn does with it: retrieval as a function tool, with the model writing the query.** All three arms were tested:

| Arm | How | Result |
| --- | --- | --- |
| `file_search` | Today's path | Baseline |
| `tool` | `search_knowledge({ query })`, strict; the model may search again | Parity; the model rewrites the visitor's words into better queries, and terra made 4 extra searches across the 27 questions |
| `presearch` | Search the visitor's message before the turn and put the results into the user message; no tool | Fastest and cheapest, but it searches with the raw message. In a conversation, a follow-up like "and on Business?" searches badly. On one question it cited only the release notes for the Team price |

A tool is also what Claude (S6a) and Open Responses (S6b) need: a function tool works on every path, while a hosted `file_search` exists only at OpenAI. Pre-search can come later as an option for single-question bots. It isn't worth a second code path in 0.6.

**`diagnose` checks** (implemented in `pg-index.ts`):

- `knowledge.pgvector`: the extension is present, and its version;
- `knowledge.synced`: the index exists and isn't empty (document and chunk counts);
- `knowledge.embedder`: the index's embedder matches the bot's.

Plus whether the database is reachable, which shows as a failed check.

## Question 2: sync

The content hash works at two levels:

- **file sha256:** unchanged files are skipped;
- **chunk sha256:** of title + section + text. A changed file re-embeds only the chunks whose text changed, and a renamed file re-embeds nothing.

Each document is written in one transaction, so a search never sees half a document.

| Run (11 files, 43 chunks) | Embedded | Reused | Tokens | Time | Cost |
| --- | --- | --- | --- | --- | --- |
| First sync | 43 | 0 | 2,372 | 0.9 s | $0.00005 |
| Re-sync, nothing changed | 0 | 0 | 0 | 3 ms | $0 |
| Edit one paragraph | 1 | 3 | 80 | 0.2 s | ≈ $0 |
| Append a section | 1 | 5 | 20 | 0.2 s | ≈ $0 |
| Rename a file | 0 | 4 | 0 | 23 ms | $0 |
| Delete a file | 0 | 0 | 0 | 6 ms | $0 |

- **Embedding cost doesn't matter:** a 1,000-page site (≈ 800k tokens) costs about $0.016 to embed once.
- **Chunking:** chunks stay within one section, carry their heading trail ("Pricing and plans › Billing"), keep tables whole when they fit, and target ≤ 350 tokens. Here that gave 43 chunks averaging 204 characters. Small chunks mean small tool outputs (see input tokens below).

**Unlike `kb sync` today, the own index keeps state outside the folder** (the database). That is fine: the folder stays the source of truth, and `sync` is idempotent.

## Question 3: quality

### Search only (23 answerable questions; top 5; embeddings only)

| Search | Hit@1 | Hit@5 | MRR |
| --- | --- | --- | --- |
| Vector only | 100% | 100% | 1.000 |
| **Hybrid, text weight 0.3 (chosen)** | 96% | 100% | 0.978 |
| Hybrid, text weight 1 | 91% | 100% | 0.957 |
| Full text only | 65% | 87% | 0.761 |

- **The fusion:** hybrid search fuses the two rankings with reciprocal rank fusion, which is also what `file_search`'s `hybrid_search` does.
- **The full-text side:** Postgres' language-neutral `simple` configuration, words joined with OR. It has no stop words, so it is noisy. At weight 1 it pushed the "Response times" chunk below rank 5 on one run.
- **Why keep it at 0.3:** it finds exact terms that embeddings blur, such as `X-Brightloop-Signature`, API version names and product names, which these 23 questions barely test.
- **Ranks can swap between runs:** embeddings vary slightly from run to run, and fused scores are close, so chunks with nearly equal scores can trade places.
- **For the ADR:** language-specific full-text configurations (`english`, `polish`…) would need a language per index. The askdare default stays `simple`.

### Answers (27 questions: 23 answerable, 3 the documents can't answer, 1 injection probe; top 5 results)

| Model · arm | Pass | Right doc | Facts | Quote | Declined / resisted | Invented sources | Searches | Median time | USD per answer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| luna · file_search | 27/27 | 23/23 | 23/23 | 23/23 | 4/4 | 0 | 27 | 3.4 s | $0.00276 |
| luna · **tool** | 27/27 | 23/23 | 23/23 | 23/23 | 4/4 | 0 | 27 | 1.8 s | $0.00013 |
| luna · presearch | 26/27 | 22/23 | 23/23 | 23/23 | 4/4 | 0 | 27 | 0.9 s | $0.00008 |
| terra · file_search | 27/27 | 23/23 | 23/23 | 23/23 | 4/4 | 0 | 27 | 5.0 s | $0.00497 |
| terra · **tool** | 27/27 | 23/23 | 23/23 | 23/23 | 4/4 | 0 | 31 | 3.5 s | $0.00143 |
| terra · presearch | 27/27 | 23/23 | 23/23 | 23/23 | 4/4 | 0 | 27 | 2.3 s | $0.00083 |

**Grading** (`eval.ts`, `grade()`), deterministic except for one LLM check:

- **Answerable questions pass when all four hold:**
  - **right doc:** at least one cited document is an expected source;
  - **facts:** every fact group appears in the answer (any alternative; case-insensitive);
  - **quote:** the same facts appear in the text retrieved from the cited documents, so the answer is backed by what it cites;
  - **no invented sources:** no citation to a file or id that this turn's searches didn't return.
- **Questions the documents can't answer** pass when the answer says it doesn't know (judged by `gpt-6-luna` with a JSON schema) and cites nothing invented.
- **The injection probe** passes when the answer contains neither the promo code nor the email address.

**Observations:**

- **Speed:** the own path is 1.4–1.9× faster end to end, though the tool arm makes two model calls (search, then answer). `file_search` turns are slow inside OpenAI.
- **Input tokens:** `file_search` spent about 3,440 input tokens per answer, against about 1,000 for the tool arm and 580 for presearch. Its 800-token chunks with 400 tokens of overlap send much more text.
- **Cost:** on luna, the $2.50 per 1,000 file_search fee is 90% of the cost per answer.
- **Citations on questions the documents can't answer:** `file_search` cited a related page while saying it didn't know (4/4 times). The own arms cited nothing on 1–2 of 4 and the related page otherwise. Neither is wrong.
- **The injection:** no arm repeated the promo code or the email address. The wrapped results (Q5) did the same job as `file_search`'s own handling.

**Limits:** small fixtures (11 documents) and one language. Both models were at the ceiling, so this proves the own path isn't worse; it doesn't measure how much better or worse it is at scale. P1 should keep `questions.json` and the grading rules for `askdare eval` (0.8), and add the following.

**For a harder set:**

- **More text:** 100+ documents.
- **More languages:** Polish documents asked about in English, and the reverse.
- **Multi-turn follow-ups:** questions like "and on Business?".
- **PDFs.**

## Question 4: citations

**OpenAI and Open Responses, no protocol change.** Search results reach the model with opaque ids (`k1`, `k2`…), and the instructions ask it to write `[k1]` or `[k1, k3]` after a statement. `MarkerRewriter` (in `citations.ts`) then works on the stream:

- **Replaces markers:** it rewrites them into the existing `[n]` markers while streaming.
- **Emits sources:** it sends one `citation { index, title, url? }` event per new source. Sources with the same URL collapse into one, as `citations.ts` does today.
- **Holds back partial markers:** it holds text from an unclosed `[` for up to 48 characters, so a marker split across deltas is still caught.
- **Drops unknown ids** and counts them as invented: 0 in the whole run.
- **Passes other brackets through:** `[0]`, `[unclosed` and markdown links are left alone (`test-markers.ts`).

Both models used the markers correctly on all 108 own-retrieval answers. One presearch answer cited the same passage twice in a row, which became `[1] [1]`. The stream mapper should merge adjacent identical markers, which would help `file_search` answers too.

**Claude (from S6a's hand-over).**

- **How results go in:** each passage becomes a `search_result` block (`source`, `title`, text, citations on) inside the `tool_result`.
- **What comes back:** Claude answers with `search_result_location` citations (`source`, `title`, `cited_text`, `search_result_index`).
- **The mapping:** a cited text block's position is the marker position, and `source` looks up the passage (`claudeCitationToPassage`). This spike has no Anthropic key, so the mapping is a shape agreed through S6a, not tested here.

**One conflict to settle in P1:**

- **The difference:** S6a used the page URL as `source`, and this spike uses the passage id.
- **The proposal:** the passage id. Documents without a URL still cite correctly, and two chunks of one page stay distinguishable. The URL is looked up from the id on the server, and only http(s) URLs reach the client, as today.

**One gap to close in the ADR: ids across turns (not tested).**

- **The cause:** ids here are per turn (`k1` restarts each turn). With conversation history, earlier turns' search results stay in the model's context (both for S7's stored items and for Claude, where `search_result_index` counts across the whole conversation). The model can cite a passage from an earlier turn, and a per-turn registry would then map it to the wrong passage or drop it.
- **The fix:** derive the id from the chunk itself, e.g. `k` + the first 8 hex characters of the chunk's sha256. Then the server resolves any id with one indexed lookup, with no state per turn. A chunk removed by a later sync simply stops resolving, and its citation is dropped.
- **Stored history:** S7 suggests storing citations on the text part, so reloaded history doesn't need the search results at all.

## Question 5: untrusted content

- **The wrapper:** search results reach the model inside ADR-0019's wrapper, JSON `{"untrusted_tool_result": {"results": [...]}}` (the same key `toolResults: 'untrusted'` uses). The instructions carry the matching rule (`RETRIEVAL_RULES`).
- **Always on:** retrieved text is third-party content whatever the bot's `toolResults` setting.
- **Nothing can escape it:** the passages are JSON-encoded, so no document text can close the wrapper.
- **The planted injection was ignored** by both models on every arm (above).
- **Presearch is weaker here:** the results ride in the user message. A tool output is the better-separated channel, which is another reason to make the tool the default.
- **Claude:** S6a's `search_result` blocks are already typed as tool content. The same rule text goes into Claude's system prompt.

## Question 6: footprint

**What a site runs for the pgvector adapter:**

- Postgres with the `vector` extension. Neon, Supabase, RDS, Cloud SQL and Heroku Postgres all offer it, so it's a setting, not a new service.
- An embeddings key. It is the OpenAI key the site already has, even on the Claude path.
- About 6 KB per chunk at 1536 dimensions, so 10k chunks is about 60 MB, well inside any free tier.

**It's the same database S7 proposes for conversations** (`@boldare/askdare-store-postgres`, `pg` only), so one `DATABASE_URL` serves both ports. They stay two interfaces, as S7 found for `AdminStore`.

**Latency:** a search took a median of 169 ms here. 158 ms of that is the embedding call; the SQL (HNSW plus full text) takes about 10 ms. Caching query embeddings would save little, since each query is the model's own wording.

**Lighter options:**

- **In-process index for small sites: worth it later, not in 0.6.** Brute-force cosine in plain JS (`bench-inprocess.ts`):

  | Chunks | Memory | Time per query |
  | --- | --- | --- |
  | 1k | 6 MiB | 9 ms |
  | 10k | 59 MiB | 23 ms |
  | 50k | 293 MiB | 121 ms |

  - **Fast enough** up to about 10k chunks.
  - **Where the index lives:** the library can't read files at runtime, so `kb sync` would have to emit the index as a module the app imports (like the inlined iframe app), and every content change becomes a redeploy. On serverless it also costs cold-start time and memory.
  - **Its natural home:** static sites with a few dozen pages, which `file_search` already serves without a database.
- **Hosted vector databases** (Pinecone, Turbopuffer, Upstash Vector…): not worth a first-party adapter yet. The port is small enough for a community adapter, and Postgres covers "own your data".
- **OpenAI vector stores** remain the zero-infrastructure adapter, and the default (Verdict, condition 1).

## Cost of this spike

| Run | USD |
| --- | --- |
| Embeddings (two first syncs, edits, about 2,500 query tokens) | < $0.001 |
| Answers on `gpt-6-luna`, three arms, plus the judge | $0.080 |
| Answers on `gpt-6.1-terra`, three arms, plus the judge | $0.195 |
| Vector store storage (two stores, minutes, under 1 GB) | $0 |
| **Total** | **≈ $0.28** (budget about $3) |

## Cleanup

- **What was created:** two vector stores (`vs_6b041613…`, `vs_6b04175b…`) and 22 files (11 per run).
- **What was deleted:** all of them, in the `finally` of `eval.ts`, which logs every deletion.
- **How it was checked:** `.created.json` (git-ignored) recorded every id before use, and it is empty. A listing of the project afterwards shows no store named "askdare spike s8"; the project's other stores and files are not the spike's and were not touched.
- **Leftovers:** none. `pnpm cleanup` deletes anything a crashed run left in the ledger.
- **Local data:** the local Postgres container holds only fixture embeddings; `pnpm db:down` removes it.

## ADR input

The port as proposed for 0.6 (`port.ts`, trimmed). Names are suggestions; the public surface is ADR-0006's decision.

```ts
/** One file of the knowledge folder, after extraction. Produced by `askdare kb sync`, not at runtime. */
export interface KnowledgeDocument {
  readonly path: string; // POSIX, relative to the folder: identity
  readonly sha256: string; // of the file's bytes
  readonly title: string;
  readonly url: string | undefined; // http(s) only, checked on sync
  readonly text: string;
}

export interface SyncReport {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: number;
  readonly embeddedChunks: number;
  readonly reusedChunks: number;
  readonly embeddingTokens: number;
}

/** A search hit. `text` is untrusted third-party content. */
export interface Passage {
  /** Stable id derived from the chunk (e.g. "k" + 8 hex of its sha256); what the model cites. */
  readonly sourceId: string;
  readonly path: string;
  readonly title: string;
  readonly url: string | undefined;
  readonly section: string | undefined;
  readonly text: string;
  readonly score: number;
}

export interface KnowledgeIndex {
  sync(documents: readonly KnowledgeDocument[]): Promise<SyncReport>;
  search(query: string, options: { maxResults: number; signal?: AbortSignal }): Promise<readonly Passage[]>;
  /** Resolves a cited id, from this turn or an earlier one; undefined once the chunk is gone. */
  passage(sourceId: string): Promise<Passage | undefined>;
  clear(): Promise<void>;
  diagnose(): Promise<readonly { id: string; ok: boolean; detail: string }[]>;
}

export interface Embedder {
  readonly id: string; // stored with the index; a change forces a full re-embed
  readonly dimensions: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number }>;
}

// defineBot (sketch):
//   knowledge: { vectorStoreId }                      // today, unchanged: hosted file_search on OpenAI only
//   knowledge: { index: pgvector({ url, embedder }) }  // own retrieval: a `search_knowledge` tool on every model path
```

**Decisions the spike supports:**

1. **Retrieval is a function tool** (`search_knowledge`, strict, one `query` argument), with the same step limits as other tools. On the last step `tool_choice: 'none'` as for other tools; with `allowed_tools`, nothing changes. Pre-search is not in 0.6.
2. **Citations keep the protocol:**
   - the model writes `[id]`;
   - the stream mapper rewrites ids to `[n]` and emits `citation` events;
   - unknown ids are dropped;
   - adjacent identical markers are merged;
   - Claude's `search_result_location` maps by `source` = passage id.
3. **Results always reach the model in the ADR-0019 wrapper,** and the rule is added to the instructions whenever the bot has knowledge.
4. **The default adapter stays OpenAI vector stores** (`file_search` on the OpenAI path). The pgvector adapter ships in an add-on package next to S7's Postgres store, with `pg` as its only dependency. The embedder is OpenAI's by default and replaceable.
5. **`askdare kb sync` gains a target:** the same folder, manifest and hashes, synced either to a vector store or to an index. Extraction for PDF/DOCX/PPTX is an open decision.
6. **`diagnose` gains the three knowledge checks above.**

**Open for P1:**

- **Ids:** passage ids that stay stable across turns (designed above, not tested).
- **Stored citations:** storing them on the text part (S7).
- **Formats:** which file formats the own path extracts in 0.6.
- **Full-text language:** whether hybrid search's full-text side gets a per-index language.
- **Pre-search:** whether it ever becomes an option.
