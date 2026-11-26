# @boldare/askdare

## 0.6.0

### Minor Changes

- 6580516: Fixes from the review of 0.6's public API:
  
  - **`askdare doctor`** creates and deletes a test conversation at OpenAI only for apps whose conversations OpenAI keeps: the check is now `openaiConversations().diagnose()`, run once per app instead of once per bot. With a store that keeps the items, such as `postgresConversations()`, nothing of yours calls the Conversations API, which isn't eligible for Zero Data Retention.
  - **Signing in or out while an answer streams** (`askdare('identify')`, or `Root`'s `identity`) now stops that answer in the chat, as stopping the chat does. The server still finishes it in the previous person's conversation. Before, the rest of the answer appeared in the next person's chat (from their own history, so nothing crossed between users).
  - **The widget is about 3 KB smaller** (gzipped): its iframe app now ships only marked's lexer, as `@boldare/askdare/react` does since this release.
- 5a837ba: `limits.compactAt` compacts long conversations kept in your own store, such as `@boldare/askdare-postgres` (ADR-0029). It is off unless you set it, between 20,000 and 272,000 tokens.
  
  - Once a turn's last model call reads that many input tokens, askdare sends OpenAI one request after the turn, in the background, and stores the encrypted summary it returns with the conversation. The next turns replay from the summary instead of from the start, so they cost less and use less of the token budgets. In spike S9, 50 turns cost 27–56 % less, and three to four times fewer budget tokens.
  - The visitor never waits for it. It reads the prompt cache the turn just wrote, is charged to the same budgets, and reaches `onUsage` as its own `compaction` entry (new type `ChatCompactionReport` in `@boldare/askdare/next`).
  - Nothing stored is changed or removed: history, paging and deletion work as before. A visitor who writes again while it runs drops it, and a later turn tries again. When the summaries leave too large a floor, a conversation stops compacting.
  - `openaiConversations()`, the default, never compacts. `createChatHandler` warns at startup when a bot sets `compactAt` with it.
  - The `ConversationStore` port gains `kind: 'compaction'` on `native` items and a `model` option on `context()`, where the replay window starts at the latest compaction item (new type `CompactionModel`). `conversationStoreContract` tests it. A custom store that ignores the option still works, but reads the whole conversation on every turn.
  - `@boldare/askdare-postgres`: `context()` starts at the latest compaction item, found in SQL. No migration.
  
  See [Configuration](https://github.com/boldare/askdare/blob/main/docs/configuration.md#compaction), [Costs](https://github.com/boldare/askdare/blob/main/docs/costs.md#long-conversations-and-compaction) and [Privacy](https://github.com/boldare/askdare/blob/main/docs/privacy.md#with-your-own-conversation-store).
- c8e4269: Conversations now go through a `ConversationStore` port (ADR-0024). Nothing changes for apps that don't set it: the default, `openaiConversations()`, keeps conversations at OpenAI as before.
  
  - `createChatHandler({ conversations })` chooses the store, on the server only. `openaiConversations({ apiKey? })` is exported from `@boldare/askdare/next`; without `apiKey` it reads `OPENAI_API_KEY`.
  - `@boldare/askdare` exports the port and its types (`ConversationStore`, `ConversationOwner`, `ConversationInfo`, `ConversationContext`, `ConversationPage`, `ConversationStoreCheck`, `StoredItem`, `StoredPart`, `StoredCitation`, `PositionedItem`), `VersionConflictError`, and `memoryConversations()`, an in-memory store for tests and local development.
  - The new subpath `@boldare/askdare/testing` exports the contract suites `conversationStoreContract` and `rateLimitStoreContract`. They take your test runner's `describe`, `it` and `expect`, so they work with Vitest or Jest.
  - The server now checks that a resumed conversation belongs to the bot and the visitor named in the resume token, as the store records them. A conversation that doesn't is answered like one that no longer exists. With the default store this costs one extra request to OpenAI for each message in an existing conversation and each deletion; the history load makes it alongside its own. Conversations created by earlier versions keep working.
  - New conversations at OpenAI carry the metadata `askdare_owner` (`visitor:<id>` or `user:<key>`) instead of `askdare_visitor`.
- 225577a: Visitors who come back to a long conversation can now scroll up to read all of it, in the widget, in the chat inside a page and with the headless API. The chat still opens on the latest page of the conversation, and loads older pages one at a time from the cursor that `POST /history` returns.
  
  - **The default look** shows a "Show earlier messages" button at the top of the conversation. It loads as the visitor scrolls up to it, and works as a button from the keyboard. The older messages go in above without moving what the visitor was reading, and screen readers hear "Earlier messages loaded." Focus stays on the button, in view; once the start is reached and the button goes away, the oldest message takes focus.
  - **Headless:** `state.earlier` (`'more'`, `'loading'` or `'none'`, new type `Earlier`) and the action `loadEarlier()`. The new primitive `LoadEarlier` renders the button (part `load-earlier`, with `data-loading` while a page loads). `Messages` keeps the visitor's place whatever control loads older messages.
  - **New texts:** `history.earlier`, `history.loading`, `history.loaded` and `error.earlier`, in every built-in language.
  - A page that fails to load shows `error.earlier` and can be tried again. A cursor the server refuses ends paging until the chat reloads. Starting over or signing in drops the cursor.
  
  See [React: Long conversations](https://github.com/boldare/askdare/blob/main/docs/react.md#long-conversations).
- 87c0d04: `POST /history` now pages back through a whole conversation instead of stopping at its latest 100 items (ADR-0024, decision 7). It answers one page of whole turns, newest page first, and a `before` cursor when older messages exist; sending that cursor back as `before` reads the page before. A turn is never split between pages, so each answer keeps its cards, its rating handle and, under output checks, its verdict. Only the latest page carries reply options. This works with `openaiConversations()` and with stores that keep the items, such as `postgresConversations()`.
  
  The cursor is opaque and bound to its conversation: one from another conversation, forged or expired answers `400`. It is additive within protocol version 1: clients that send no cursor get the latest page, as before. The widget, the chat inside a page and the headless API load older pages as the visitor scrolls up.
  
  Custom conversation stores: `page()` must return the same items for the same `before` and `limit`, honour a `limit` of up to 200, and keep `before` within 1,024 characters (see [Custom stores](https://github.com/boldare/askdare/blob/main/docs/custom-store.md)).
- e2386f1: `askdare kb sync` can now sync a knowledge folder into your own index in Postgres instead of an OpenAI vector store (ADR-0025). `kb sync <folder> --index <id>` builds `pgvectorIndex` from `@boldare/askdare-postgres` (install it in the app) with `DATABASE_URL`, and embeds with OpenAI using `OPENAI_API_KEY`.
  
  - The embedding model and vector size are required: `--embedding-model` and `--dimensions`, or `ASKDARE_EMBEDDING_MODEL` and `ASKDARE_EMBEDDING_DIMENSIONS`. There is no default model. Use the same ones as the bot's `openaiEmbedder`; another model or size makes the next sync embed everything again.
  - The sync is incremental. An unchanged file is skipped, an edited file re-embeds only its changed chunks, and a renamed file with a title from front matter or `askdare.kb.json` re-embeds nothing. The report lists added, changed, removed and unchanged documents, and the chunks and tokens embedded or reused.
  - The index reads `.md`, `.markdown`, `.mdx`, `.txt`, `.html` and `.htm`. Other files, PDFs and `.json` included, are skipped with a warning. The vector-store path still takes them.
  - `--dry-run --index` reads and chunks the folder without a database or a key.
  
  The vector-store path is unchanged, except that it now reads front matter with the same parser as the index. A closing `---` must now end its line.
- 64af8bb: `createChatHandler({ onTranscript })` hands you each finished turn, so you can keep your own transcripts with any conversation store (ADR-0016). It is off unless you set it, and it is the only hook that receives message content.
  
  - It gets what the visitor sent, after `onInput` (a redacted message arrives redacted), and the answer they saw, after output checks: the replacement of a replaced answer, nothing of a withheld one. With it come the answer's sources, the number of attached files, the end reason, the output check's verdict, and the identifiers `onFeedback` gets: the bot, the visitor's pseudonym, the signed-in user and the raw conversation and answer IDs. Never instructions, page context, file names, tool calls or their results.
  - It runs after the answer has streamed and the conversation is free for the next message, kept alive with Next.js `after`. It isn't called for blocked messages or for turns that failed before their answer finished.
  - Nothing it throws reaches the chat. `onError` receives an `internal_error` that names only the error's class, never its message, so a failed database write can't put the visitor's text in your logs.
  - New types `ChatTranscriptReport` and `ChatTranscriptCitation` in `@boldare/askdare/next`. See [Configuration](https://github.com/boldare/askdare/blob/main/docs/configuration.md#ontranscript) and [Privacy](https://github.com/boldare/askdare/blob/main/docs/privacy.md#transcripts).
- ff7c762: When a visitor's connection drops in the middle of an answer, the chat now carries on with the rest of it instead of showing an error, in the widget, in the chat inside a page and with the headless API.
  
  - **How:** a stream that ends before the answer did is resumed with `POST /resume`, after the last event the chat received, so no text is shown twice. It tries after half a second, then 2 and 8 seconds while nothing new comes, and at most ten times for one answer. Meanwhile the status says "Reconnecting…", which screen readers hear politely.
  - **When it can't be resumed** (the server no longer has the answer's events, as with the default in-memory log on another instance, or the attempts ran out), the chat reloads the latest page of the conversation and shows the finished answer from there. Older pages already shown stay. Only when the answer isn't stored yet does the chat show "Connection problem. Please try again." as before.
  - **Headless:** `state.activity` is `status.reconnecting` while an answer resumes. `message.received` fires once per answer, as `completed` when it was resumed or taken from the history.
  - **New text:** `status.reconnecting`, in every built-in language.
  - **Smaller React bundles:** a page that uses `Root` and `useChat` without `Markdown` no longer bundles the Markdown renderer (about 1.2 KB gzipped less), and `@boldare/askdare/react` no longer ships the parts of marked it never used, only its lexer (about 3 KB gzipped less). Answers render as before.
  
  Resuming across instances needs a shared turn log, such as `upstashTurnLog()`. See [Configuration: `resume`](https://github.com/boldare/askdare/blob/main/docs/configuration.md#resume) and [Troubleshooting](https://github.com/boldare/askdare/blob/main/docs/troubleshooting.md#the-chat-reconnects-in-the-middle-of-an-answer).
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
- 1107680: Conversation stores that keep the items themselves now work: `createChatHandler({ conversations: memoryConversations() })` no longer refuses one, and `postgresConversations()` from `@boldare/askdare-postgres` plugs in the same way (ADR-0024).
  
  - With such an item store, each turn replays the stored conversation to OpenAI with `store: false` and appends everything it produces to your store. Nothing of the conversation stays at OpenAI beyond its 30-day abuse monitoring of requests, so organisations with Zero Data Retention can use askdare. Attached files are still uploaded to OpenAI.
  - Requests are larger, since they carry the whole conversation, the model's encrypted reasoning included; spike S7 measured the same cost, as the replay is read from the prompt cache. Reasoning is replayed only to the model family that wrote it.
  - A crash loses at most the model call in flight, and never leaves a tool call without its output. Of two turns started on the same conversation at once, one ends with `rate_limited` ("The previous answer in this conversation is still on its way").
  - History (`POST /history`) reads item stores too, with citations, reply options and tool cards. Answers are rated by their ID in your store.
  - The default, `openaiConversations()`, works as before.
- 94ed842: A visitor whose connection drops in the middle of an answer no longer loses it: the server keeps the answer's events for a few minutes, and a client can continue from the last one it received with the new `POST /resume` (ADR-0027). The widget, the chat inside a page and the headless API use it.
  
  - Every event frame of `POST /messages` now carries an SSE `id:`, the event's sequence number in its turn. `POST /resume` takes `{ botId, resumeToken, messageId, after }` and streams the events after `after`, then the live ones, until `message.end` or `error`, each once. An answer that is unknown, expired or not the visitor's answers `404`. Additive within protocol version 1; see [Protocol](https://github.com/boldare/askdare/blob/main/docs/protocol.md#resuming-an-answer).
  - `createChatHandler({ resume: { log } })` chooses where answers' events are kept. The default, `memoryTurnLog()`, keeps them per instance, so a reconnect to another instance reloads the conversation instead. With several instances, use `upstashTurnLog()` from `@boldare/askdare-upstash`. New exports: `memoryTurnLog`, `MemoryTurnLog`, `MemoryTurnLogOptions`, `TurnEventLog` and `TurnEvent` from `@boldare/askdare`, `ChatHandlerResumeOptions` from `@boldare/askdare/next`, and `turnEventLogContract(name, create, { describe, it, expect, ttlMs?, elapse? })` with `TurnEventLogContractOptions` from `@boldare/askdare/testing`, to test your own log.
  - Privacy: the log holds the text of answers being written, under an HMAC, for the bot's turn timeout plus one minute after each answer's last event (three minutes by default). Nothing about it is logged. See [Privacy](https://github.com/boldare/askdare/blob/main/docs/privacy.md#turn-log).

## 0.5.3

### Patch Changes

- fe4de07: The token budget reserved before each model call now counts a conversation's history once. Before, after a message in which the bot called tools, the next message reserved the input of all its model calls, about three times the history after one with three calls, so long conversations with tool-using bots ran out of `dailyTokensPerIp` a few turns early. Real usage still replaces the reservation when the message ends, and `onUsage` still reports the summed counts. Nothing to change.

## 0.5.2

### Patch Changes

- 1cbfce3: Token budgets now count input read from the prompt cache as a tenth of a token, close to what it costs. Before, `dailyTokens`, `dailyTokensPerIp` and `globalDailyTokens` charged it at full weight, so a long conversation ran out of the default per-IP budget after about 13 turns while costing cents. Everything else (other input, cache writes, output) still counts as whole tokens, and the estimate reserved before each model call is unchanged. `onUsage` still reports the raw token counts from OpenAI.
  
  Budgets now last longer for conversations with a warm cache; the money ceiling in the cost guide still holds when you take 10 × the cached-input price into account. Nothing to change unless you sized your budgets for full-weight cached input.
- 5dbcb19: Answers no longer show the same citation marker twice in a row: `[1] [1]` and `[1][1]` become `[1]`, while streaming and in reloaded history. A Responses-compatible server that leaves out the optional usage details (`input_tokens_details`, `output_tokens_details`) no longer fails the turn; the missing counts are reported as 0.

## 0.5.1

### Patch Changes

- 87d0133: The `jose` dependency, which encrypts the resume token, is updated to 6.2.18.
- da8f8dc: Answers render more Markdown correctly: the bundled `marked` is updated to 18.2.1, with fixes for block quotes and lists with lazy lines, tabs, link destinations, bracket escapes in code spans, task-list markers and trailing blank lines in fenced code. `@boldare/askdare/react` grows by about 0.5 KB gzipped; its size budget is now 34 KB (ADR-0028).
- 5b84434: The `openai` dependency is updated to 7.62.0 (from 7.56.0). Nothing changes in how askdare calls the API.

## 0.5.0

### Minor Changes

- 2be0e0a: Optional bot protection, both off by default; a bot that turns neither on works as in 0.4.
  
  - **Human check with Cloudflare Turnstile:** `security: { humanVerifier: turnstile({ siteKey }) }` in `defineBot`, with the secret key in `TURNSTILE_SECRET_KEY`. The chat shows the Turnstile widget when it needs a new session, and `/session` checks the token with Cloudflare; renewing a live session needs no new check for 24 hours after the visitor passed one. For that bot only, the iframe's Content Security Policy allows `https://challenges.cloudflare.com` in `script-src` and `frame-src`. A chat inside your page must allow the same origin in your page's policy, and a headless chat renders the new `HumanCheck` primitive. To check tokens another way, implement the `HumanVerifier` type.
  - **`limits.requireSharedStore`** in `createChatHandler`: with `true`, the route refuses to load unless `limits.store` is shared, instead of only warning in production.
  
  New texts `humanCheck.label` and `error.humanCheck`, a `human-check` part, and `state.humanCheck` in the React hooks.
- 1b5c112: New `Disclosure` primitive in `@boldare/askdare/react`: the AI notice (EU AI Act, art. 50) for your own markup and for your own page in the widget's iframe. It shows `disclosure.text` with the `widget.disclosure.privacyUrl` link, takes children to replace the text, and renders nothing with `disclosure: false`. The default look now uses it, with the same markup as before.
  
  In development, `Root` and `EmbedRoot` note once in the console when the chat rendered without a `Disclosure` while the bot keeps the notice on; `widget.disclosure: false` silences it. `askdare doctor` lists bots with `disclosure: false` as information, not a failure. Nothing changes for existing bots.
- 1f19a17: Guardrails, all opt-in and set in `defineBot` (ADR-0019). A bot that sets none of them behaves exactly as before.
  
  - `moderation: { model, check?, categories?, message? }` runs OpenAI moderation on visitors' messages (`check: 'input'`, the default), on answers (`'output'`) or both. You choose the moderation model, which categories block (default: any flagged one) and the text visitors see. Each checked message adds one call to OpenAI's moderation endpoint.
  - `onInput(text, context)` and `onOutput(text, context)` return `{ action: 'allow' }` (or `undefined`), `{ action: 'block', message? }` or `{ action: 'redact', text }`. A hook that throws lets the text through and logs one line naming the hook.
  - While answers are checked (`onOutput`, or moderation of output), they are held back on the server until complete, then sent whole, replaced or blocked; reasoning and tool status still stream. A blocked answer never reaches the browser, and a replaced one comes without its tool cards and reply options. For these bots the history shows an answer only once its check passed, and a conversation takes one turn at a time (a second message meanwhile gets `rate_limited`).
  - Blocked turns end with the existing `content_blocked` error, with your text or the translated default. Nothing blocked or redacted is logged as content. Attached files are not checked.
  - `toolResults: 'untrusted'` hands tool results to the model wrapped as third-party data that it must not follow as instructions. Recommended for tools that return text from outside your control.
  
  New exported types: `GuardrailOptions`, `ModerationConfig`, `GuardHook`, `GuardVerdict` and `GuardContext`. See `docs/guardrails.md`.
- 1b94b92: Built-in texts in Czech, German, Spanish, French and Italian, next to English and Polish. `widget.locale` set to one of these languages, or `'auto'` on a page or browser in one of them, now shows the chat and the launcher in that language with no `widget.texts` of your own. Your overrides still win. Other languages keep showing English.
- 5aecb96: Public API clean-up before 1.0 (ADR-0020, ADR-0021).
  
  - **`defineBot` now returns a `BotHandle`**, which exposes only `id` and `embedPath`. Pass it to `createChatHandler`, `getChatConfig` and `getEmbedConfig` as before. The resolved `Bot` type, with its filled-in defaults, is no longer exported. If you annotated a variable as `Bot`, use `BotHandle` (or `BotDefinition` for the input). Passing an object that didn't come from `defineBot` now throws a clear `TypeError`.
  - **`ERROR_CODES` and `ErrorCode` are exported** from `@boldare/askdare`, so you can switch on the `code` that `onError` and the chat report.
  - Node.js 26 joins the support matrix.
  - `zod` stays a required peer: `defineBot` validates every definition with it.
  
  Type-only removals can't warn at runtime a minor ahead, so this changeset names the replacements instead.

### Patch Changes

- 7f962ab: Screen readers now hear a finished answer once, as its rendered text. The conversation (`Messages`) is still a `log` but no longer a live region, since text growing inside a message was read in fragments or not at all; a visually hidden `status` next to it (`data-ask-part="announcement"`) announces each answer when it ends. Answers restored after a reload aren't read out. New guide, `docs/accessibility.md`: the dated WCAG 2.2 AA conformance statement, with its scope, method, manual review and known limitations.
- 8744972: New guide, `docs/compliance.md`: what the AI Act, the GDPR and the European Accessibility Act ask of a website chatbot, what askdare does about each, and the decisions left to you. It covers the AI disclosure, OpenAI's DPA, retention and deletion, `safety_identifier`, OpenAI's data residency (which doesn't cover the Conversations API askdare uses), the resume token in a chat inside your page, and hosts other than Vercel and Heroku (Docker, `next start`, OpenNext; no Edge runtime). It isn't legal advice.
- b5f3c44: A conversation that outgrows the model's context window now ends with "This conversation is too long. Please start a new one." (`invalid_input`, key `error.conversationTooLong`) instead of a generic "temporarily unavailable" error, should OpenAI ever refuse it. askdare keeps sending the deprecated `truncation: 'auto'` until OpenAI announces a shutdown date, so long conversations keep working as before.
- 6aacbb8: `askdare doctor` warns when OpenAI has announced a shutdown date for a bot's model or its transcription model, with the date from the OpenAI API and a link to OpenAI's deprecations page for the replacement.
- 5d745bf: A chat that fills the screen (on a phone, or a desktop page zoomed to 400%) keeps keyboard focus until it is closed, instead of letting it move to the page hidden behind it (WCAG 2.4.11).
- 08a1b01: A bot's `widget.css` can no longer reach the host page when the chat is inside a page. A stray `}` used to close the `@scope` block early, so a typo like `a { color: red } } body { display: none }` applied `body { display: none }` to the whole page. Stray closing braces are now dropped, and unclosed blocks or strings are closed, so every rule stays scoped to the chat.
- 0c0ccda: Server logs no longer risk carrying what a visitor wrote. When OpenAI rejects a request with a message that quotes the value it refused, or any other failure reaches the default error log (no `onError` set), quoted values longer than 32 characters are replaced, API keys are cut to their prefix and the message is capped at 300 characters. Status, error code, request ID and stack frames stay, so the logs remain useful for debugging.
- fe8f7d8: Docs: releases are now tested on an iPhone viewport in WebKit (Safari's engine) automatically, and no longer wait on manual checks in Safari on iOS or with screen readers. The accessibility statement says so: screen readers are not tested by hand, and what they rely on is checked by the automated tests.
- c8ed689: Docs for 0.5: `privacy.md` covers the moderation calls to OpenAI and Cloudflare as a processor for the human check, `troubleshooting.md` covers guardrail blocks, the one-turn-at-a-time hold and a failing human check, `cli.md` lists doctor's note about the AI notice, `styling.md` lists the `announcement` part, and the package READMEs list what is new in 0.5 and `limits.requireSharedStore`.
- a190bcd: Streamed answers stay smooth however long they get: `Markdown` now re-lexes and re-renders only the last blocks of a message on each delta, instead of the whole answer. Sanitizing is unchanged.
- 8fba8ee: Bots with `replies: 'suggest'` no longer write their answer twice. Current models mark an answer written before the `suggest_replies` call as commentary, and askdare took that as an unfinished turn and asked the model again, which repeated the answer. Text followed only by reply options now ends the turn as the answer, and the history shows it once.

## 0.4.0

### Minor Changes

- de9caf4: New route `GET <basePath>/config/<bot>?lang=<tag>`: the bot's public configuration in one language, built like the chat document's, so it never carries the model, instructions, tools or vector stores. It prepares switching the chat's language in place (ADR-0014, step 2). A bot with a fixed locale ignores `lang`, and an invalid tag answers `400` with `invalid_input`. Additive within protocol version 1.
- 82af455: A bot can show a page of your app in the widget's iframe instead of askdare's own (ADR-0018). Set `defineBot({ embedPath: '/askdare/support' })`, and the chat route redirects the iframe there with the visitor's language and the mode; the loader on the embedding sites doesn't change. `@boldare/askdare/next` adds `getEmbedConfig({ bots, bot, searchParams })`, the configuration for that page, and `embedPageHeaders({ bots, bot })`, the `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` headers it must send, to send from `proxy.ts`. `askdare doctor` follows the redirect and checks the page: no redirect in front of it, `EmbedRoot` on it, who may frame it and the microphone rule. The page renders the chat with `EmbedRoot` from `@boldare/askdare/embed`.
- 1e30933: Your own page in the widget's iframe (ADR-0018). A new entry, `@boldare/askdare/embed`, exports `EmbedRoot`: render it on the page a bot's `embedPath` points to, with `getEmbedConfig`, and put `DefaultChat`, an ejected copy or your own markup inside. It connects to the loader on the embedding site exactly as askdare's own page does (identity, `configure`, events, closing, language switches), so the widget on every site uses your components and draws your `toolRenderers`. Inside `EmbedRoot`, `DefaultChat` and an ejected copy of it own the document: an `h1` and a close button. A new hook, `useFrame()`, gives your own markup the same close action. The loader answers a new `askdare:hello` from its own iframe, so a page that hydrates after its load event still connects. Send the page's headers from `proxy.ts` with `embedPageHeaders`; the guide is in Embedding.
- e1fadd3: The chat switches its language in place (ADR-0014, step 2). When the page calls `askdare('configure', { locale })` or follows `<html lang>` with `data-follow-lang`, the chat no longer reloads: it fetches its texts for the new language from `GET <basePath>/config/<bot>` and keeps the conversation, the unsent message and an answer still streaming, which now finishes instead of being reported as `stopped`. New answers follow the new language. If the texts can't be loaded, the chat reloads as before. In React, a `Root` whose config changes only its `locale` switches the same chat instead of starting another one. `GET /config/<bot>` also answers `Content-Language`, the language its texts are written in.
- c994c50: A bot can give its texts per language: `widget.texts` also takes `{ en: {...}, pl: {...} }`, one set of overrides per language, so a chat with `locale: 'auto'` shows your own texts in each language (ADR-0014, step 2). A visitor gets the set for their language tag, else one for the same language; a language without a built-in dictionary gets the `en` set. The launcher on the page follows the same sets. A set's key wins over the `title`, `greeting`, `placeholder` and `launcherLabel` shortcuts for its language. The flat form is unchanged and still applies in every language. The chat document's `lang` follows a set written for the visitor's language.
- 3c7a2ca: Tool cards in the chat inside your page (ADR-0017). Give `Root` your components with `toolRenderers={{ find_slots: SlotList }}`, and the chat draws each tool's `ui` payload with its component under the answer, live and after a reload. A component gets `{ data, name, callId }`, typed from the tool with `ToolRendererProps<typeof findSlots>` and `import type`; `satisfies ToolRenderers<[typeof findSlots]>` checks the whole map. New primitives: `ToolResults` (parts `tool-results` and `tool-result`, with `data-ask-tool`), which `DefaultChat` places under the answer's text, and `Link`, which allows only `https`, `http` and `mailto` URLs from a payload. A tool without a component shows nothing, and a component that throws leaves out only its card. In the script-tag widget, a bot draws them when its iframe shows your own page (`embedPath` and `EmbedRoot`); askdare's own iframe page has no components to draw them with.
- 4ff33c4: Tools can pick what the visitor sees of their result (ADR-0017). `defineTool({ ui: (result) => data })` returns plain JSON of at most 8 KB for a card, list or table; only that reaches the browser, never the result itself. The server sends it as a new `tool.ui` event after the call (additive within protocol version 1), and `POST /history` brings every answer's payloads back as `ui` after a reload. At most 4 per answer, in call order; a failed call, a throwing `ui` or a payload over the limits shows nothing. `Tool` now carries the tool's name and payload type (`Tool<Name, Ui>`), so the React components that draw the payloads (`toolRenderers`) are typed from the tool. The browser keeps them on `ChatMessage.ui`.

### Patch Changes

- ca03828: Dependencies: `openai` ^7.56.0 (was ^7.52.0) and `jose` ^6.2.17 (was ^6.2.15). Nothing changes in askdare's API.
- 95fb6e2: The README's "What you get" picture now shows what 0.4 adds: tool cards, drawn by your own React components, your own page inside the widget, and texts per language.

## 0.3.0

### Minor Changes

- bca8d48: The chat can show clickable reply options under the latest answer ("Yes, book it", "Show prices"), in the widget and inside a page. A click sends the option as the visitor's own message. It adds a `replies` protocol event (additive in protocol version 1) with `replies` on the latest answer in the history, `ChatMessage.replies`, the `QuickReplies` primitive with the `replies` and `reply` parts, the theme variant `replies` (`answer` puts the options under the answer, `composer` puts them in one row above the message field), the `message.replies` text, and `source: 'reply'` on the `message.sent` chat event. Options are plain text: at most four, up to 80 characters each, without links. The model suggests options with `widget.replies: 'suggest'`, and a tool defines them with `defineTool({ replies })` (ADR-0015).
- 9fed4d3: A tool can offer clickable reply options derived from its result: `defineTool({ replies: (result) => ['Track the parcel', 'Talk to a person'] })`. `replies` gets the successful result as the model received it (parsed back from JSON) and is typed from `execute`; the options come back after a reload, from the stored call. The same limits as every reply option apply: at most four, up to 80 characters, plain text without links. Only the options reach the browser, never the tool's result (ADR-0015).
- 35ee326: The chat can switch language without a page load (ADR-0014, step 1). On a page with a bot set to `locale: 'auto'`, `askdare('configure', { locale: 'pl' })` or `data-follow-lang` on the script tag (which follows the page's `<html lang>`) switches the launcher's texts at once and reloads the chat in the new language. The visitor keeps their conversation; new answers follow the new language, as `context.locale` in your `instructions`. An answer still streaming during the switch is reported as `message.received` with `outcome: 'stopped'`, and the server still finishes and stores it. A bot with a fixed locale ignores the switch and says so once in the console. A `configure` call with only `locale` keeps the greeting, starters and context set before. In React, pass the new `locale` to `getChatConfig` as before.
- 7357c6f: Reply options suggested by the model (ADR-0015). With `widget.replies: 'suggest'`, a bot gets the built-in tool `suggest_replies`: the model can offer 2–4 short replies under an answer, which visitors click instead of typing. The server answers the call itself (no bot code runs), cleans the options up and sends them in the `replies` event; after a reload, the history brings back the options of the latest answer. When the model suggests them after its answer, the message ends without another model call; otherwise it takes one more. `suggest_replies` is now a reserved tool name. Off by default: it costs about 250 input tokens per model call, and sometimes a model call (docs/costs.md).

### Patch Changes

- 91e6826: The bundled docs no longer say that compaction comes in 0.3, or that `embedPath` and `toolRenderers` come in 0.3: compaction has no release yet, and the other two are planned for 0.4.
- d08bd22: The README's "What you get" picture now shows what 0.3 adds: clickable answers suggested by the model, reply options from your tools, switching the chat's language from the page, and the one-click deploy.
- 9cb8282: Reply options with characters the visitor can't see are dropped: zero-width and tag characters, direction marks, private-use and unassigned code points. A click sends an option as the visitor's own message, so it now always says exactly what they read. Emoji built with the zero-width joiner still work.

## 0.3.0-rc.1

### Patch Changes

- d08bd22: The README's "What you get" picture now shows what 0.3 adds: clickable answers suggested by the model, reply options from your tools, switching the chat's language from the page, and the one-click deploy.

## 0.3.0-rc.0

### Minor Changes

- bca8d48: The chat can show clickable reply options under the latest answer ("Yes, book it", "Show prices"), in the widget and inside a page. A click sends the option as the visitor's own message. This release adds the groundwork: a `replies` protocol event (additive in protocol version 1) with `replies` on the latest answer in the history, `ChatMessage.replies`, the `QuickReplies` primitive with the `replies` and `reply` parts, the theme variant `replies` (`answer` puts the options under the answer, `composer` puts them in one row above the message field), the `message.replies` text, and `source: 'reply'` on the `message.sent` chat event. Options are plain text: at most four, up to 80 characters each, without links. Model-suggested and tool-defined options, which fill them, come in later releases (ADR-0015).
- 9fed4d3: A tool can offer clickable reply options derived from its result: `defineTool({ replies: (result) => ['Track the parcel', 'Talk to a person'] })`. `replies` gets the successful result as the model received it (parsed back from JSON) and is typed from `execute`; the options come back after a reload, from the stored call. The same limits as every reply option apply: at most four, up to 80 characters, plain text without links. Only the options reach the browser, never the tool's result (ADR-0015).
- 35ee326: The chat can switch language without a page load (ADR-0014, step 1). On a page with a bot set to `locale: 'auto'`, `askdare('configure', { locale: 'pl' })` or `data-follow-lang` on the script tag (which follows the page's `<html lang>`) switches the launcher's texts at once and reloads the chat in the new language. The visitor keeps their conversation; new answers follow the new language, as `context.locale` in your `instructions`. An answer still streaming during the switch is reported as `message.received` with `outcome: 'stopped'`, and the server still finishes and stores it. A bot with a fixed locale ignores the switch and says so once in the console. A `configure` call with only `locale` keeps the greeting, starters and context set before. In React, pass the new `locale` to `getChatConfig` as before.
- 7357c6f: Reply options suggested by the model (ADR-0015). With `widget.replies: 'suggest'`, a bot gets the built-in tool `suggest_replies`: the model can offer 2–4 short replies under an answer, which visitors click instead of typing. The server answers the call itself (no bot code runs), cleans the options up and sends them in the `replies` event; after a reload, the history brings back the options of the latest answer. When the model suggests them after its answer, the message ends without another model call; otherwise it takes one more. `suggest_replies` is now a reserved tool name. Off by default: it costs about 250 input tokens per model call, and sometimes a model call (docs/costs.md).

### Patch Changes

- 9cb8282: Reply options with characters the visitor can't see are dropped: zero-width and tag characters, direction marks, private-use and unassigned code points. A click sends an option as the visitor's own message, so it now always says exactly what they read. Emoji built with the zero-width joiner still work.

## 0.2.0

### Minor Changes

- 1a1659f: New command `npx @boldare/askdare add ui`: copies the source of the chat's default look (React components and their stylesheet) into `components/askdare`, or the folder given with `--dir`, so you can change it freely. It never overwrites files. The copy imports only `@boldare/askdare/react`, and you switch to it by changing one import of `DefaultChat`.
- ac878e6: The page can now hear what happens in the chat, for analytics such as GA4 or a GTM `dataLayer`: `askdare('on', type, listener)` with the script tag, or `onEvent` on `Root` in React. Events cover the chat opening and closing, messages sent, answers received, ratings, errors and starting over. They carry metadata only, such as counts, durations and outcomes, and never message text. See the "Chat events" guide (ADR-0013).
- 9bd1b16: Visitors' ratings of answers reach `createChatHandler({ onFeedback })`: 👍, 👎 with an optional comment, or the rating taken back, with the conversation and answer IDs for your own review. Each answer carries an encrypted rating handle in `message.end` and in the history, bound to the visitor or signed-in user, and `POST /feedback` accepts a rating only from them. A bot turns ratings off with `widget.feedback: false`. askdare stores no ratings.
- 05076dc: The chat shows 👍 and 👎 under each answer when `createChatHandler` has `onFeedback`. After a 👎 it asks "What went wrong?" with an optional comment, a second click takes a rating back, and the browser remembers the visitor's ratings across reloads. New text keys `feedback.*` (English and Polish) and parts `feedback`, `feedback-button`, `feedback-comment` and its children. In your own React markup, use `FeedbackButton` and `actions.rate`. See the new Answer ratings guide.
- d789913: The config that `npx @boldare/askdare init` writes now reads three optional environment variables. `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Blank values fall back to the defaults, and trailing slashes are dropped from origins. Without the variables the bot behaves as before. The starter's Vercel button asks for the instructions and greeting, and its Heroku `app.json` offers all three.
- 48ddabf: New entry `@boldare/askdare/react`: the chat inside a page of your own Next.js app, without an iframe. `Root` runs one bot's chat, `DefaultChat` is the widget's look ready to place, and the hooks (`useChat`, `useChatState`, `useMessage`) and primitives (`Messages`, `MessageList`, `Message`, `MessageText`, `Composer`, `Input`, `Send` and the rest) let you write your own markup on the same parts and tokens. `getChatConfig({ bots, bot })` from `@boldare/askdare/next` gives a Server Component the public configuration to pass to `Root`. React 19 is a new optional peer dependency; the script-tag widget needs nothing new. The chat talks only to its own origin, and a page that renders it shares its scripts' access to the conversation: on sites that run scripts they don't trust, keep the iframe widget.
- 94a1e30: `createChatHandler({ onUsage })` reports every chat turn once its answer has streamed, failed turns included: the tokens it used (input, cached and cache-write input, output and reasoning), the model that answered, how long it took and which tools it called, with pseudonyms instead of IDs and never any message text. Use it for cost tracking and tracing. `onError` may now be async too, and a hook that throws no longer reaches the request: askdare logs its error's name instead.

### Patch Changes

- 7c9fb36: Source links under an answer are checked like links inside it: only `http`, `https` and `mailto` URLs become links, and anything else shows as plain text. Before, they relied on the protocol validator alone.
- 66da550: The README links to askdare.vercel.app/deploy, where the one-click deploy of the starter takes about five minutes.
- c0c1a7f: docs: the one-click deploy takes about five minutes, and askdare.vercel.app/deploy makes the `CHAT_SECRET` for the Vercel form.
- 45ef7de: Fixes in the chat inside a page and its default look:
  
  - An answer or a transcript returns focus to the message field only when focus was in the chat or nowhere, never from the page's own fields, and without scrolling the page. `actions.focus()` still always moves it.
  - Ratings of one answer go out one at a time: quick 👍 then 👎 ends with what the server took, and a failed one goes back to the last rating it confirmed.
  - A comment after 👎 stays in its form until it is sent, so a failed send no longer loses the text.
  - No new dictation starts while the last one is being transcribed.
  - `<Root>` unmounting stops the answer being streamed and the uploads still running.
  - `Composer`: an `onSubmit` that calls `preventDefault()` takes the message over, Enter in the `Input` goes through `onSubmit` too, and an `onPaste` that prevents the default keeps the files out.
  - Escape outside the chat is left to the page also with `headingLevel={1}`, and Escape that a handler already used is ignored. The question before a new conversation is modal only in the iframe.
  - The default look's stylesheet styles only the chat inside `DefaultChat`, never a headless chat in the same document.
  - The rating buttons and the question after 👎 scroll into view at the end of the conversation, and messages no longer re-render on every change of the chat.
- 9540d46: The README's "What you get" picture now shows what 0.2 adds: the chat inside your own page with React, ratings of answers, observability with OpenTelemetry, and chat events for analytics.
- 1c45e8a: With reduced motion, the launcher icon no longer turns as it swaps between chat and close.
- 8608d69: Starting a new conversation now shows that it is working: the question stays open while the old conversation is deleted, with its icon turning and its buttons waiting. Before, nothing visible happened until the server answered.
- 8d81c46: The floating chat opens with a livelier animation and now animates out when it closes; the launcher icon turns between chat and close, and phones slide the full-screen chat up. Reduced motion still turns all of it off.
- eb7b7aa: The chat window is built with Preact 11.2. It looks and works the same.

## 0.2.0-rc.3

### Patch Changes

- 66da550: The README links to askdare.vercel.app/deploy, where the one-click deploy of the starter takes about five minutes.
- c0c1a7f: docs: the one-click deploy takes about five minutes, and askdare.vercel.app/deploy makes the `CHAT_SECRET` for the Vercel form.
- 1c45e8a: With reduced motion, the launcher icon no longer turns as it swaps between chat and close.

## 0.2.0-rc.2

### Minor Changes

- ac878e6: The page can now hear what happens in the chat, for analytics such as GA4 or a GTM `dataLayer`: `askdare('on', type, listener)` with the script tag, or `onEvent` on `Root` in React. Events cover the chat opening and closing, messages sent, answers received, ratings, errors and starting over. They carry metadata only, such as counts, durations and outcomes, and never message text. See the "Chat events" guide (ADR-0013).
- d789913: The config that `npx @boldare/askdare init` writes now reads three optional environment variables. `ASKDARE_INSTRUCTIONS` and `ASKDARE_GREETING` replace the bot's default instructions and greeting, and `ASKDARE_ALLOWED_ORIGINS` lists the other sites that may embed the chat, comma-separated. Blank values fall back to the defaults, and trailing slashes are dropped from origins. Without the variables the bot behaves as before. The starter's Vercel button asks for the instructions and greeting, and its Heroku `app.json` offers all three.

### Patch Changes

- 9540d46: The README's "What you get" picture now shows what 0.2 adds: the chat inside your own page with React, ratings of answers, observability with OpenTelemetry, and chat events for analytics.
- 8608d69: Starting a new conversation now shows that it is working: the question stays open while the old conversation is deleted, with its icon turning and its buttons waiting. Before, nothing visible happened until the server answered.
- 8d81c46: The floating chat opens with a livelier animation and now animates out when it closes; the launcher icon turns between chat and close, and phones slide the full-screen chat up. Reduced motion still turns all of it off.

## 0.2.0-rc.1

### Patch Changes

- eb7b7aa: The chat window is built with Preact 11.2. It looks and works the same.

## 0.2.0-rc.0

### Minor Changes

- 1a1659f: New command `npx @boldare/askdare add ui`: copies the source of the chat's default look (React components and their stylesheet) into `components/askdare`, or the folder given with `--dir`, so you can change it freely. It never overwrites files. The copy imports only `@boldare/askdare/react`, and you switch to it by changing one import of `DefaultChat`.
- 9bd1b16: Visitors' ratings of answers reach `createChatHandler({ onFeedback })`: 👍, 👎 with an optional comment, or the rating taken back, with the conversation and answer IDs for your own review. Each answer carries an encrypted rating handle in `message.end` and in the history, bound to the visitor or signed-in user, and `POST /feedback` accepts a rating only from them. A bot turns ratings off with `widget.feedback: false`. askdare stores no ratings.
- 05076dc: The chat shows 👍 and 👎 under each answer when `createChatHandler` has `onFeedback`. After a 👎 it asks "What went wrong?" with an optional comment, a second click takes a rating back, and the browser remembers the visitor's ratings across reloads. New text keys `feedback.*` (English and Polish) and parts `feedback`, `feedback-button`, `feedback-comment` and its children. In your own React markup, use `FeedbackButton` and `actions.rate`. See the new Answer ratings guide.
- 48ddabf: New entry `@boldare/askdare/react`: the chat inside a page of your own Next.js app, without an iframe. `Root` runs one bot's chat, `DefaultChat` is the widget's look ready to place, and the hooks (`useChat`, `useChatState`, `useMessage`) and primitives (`Messages`, `MessageList`, `Message`, `MessageText`, `Composer`, `Input`, `Send` and the rest) let you write your own markup on the same parts and tokens. `getChatConfig({ bots, bot })` from `@boldare/askdare/next` gives a Server Component the public configuration to pass to `Root`. React 19 is a new optional peer dependency; the script-tag widget needs nothing new. The chat talks only to its own origin, and a page that renders it shares its scripts' access to the conversation: on sites that run scripts they don't trust, keep the iframe widget.
- 94a1e30: `createChatHandler({ onUsage })` reports every chat turn once its answer has streamed, failed turns included: the tokens it used (input, cached and cache-write input, output and reasoning), the model that answered, how long it took and which tools it called, with pseudonyms instead of IDs and never any message text. Use it for cost tracking and tracing. `onError` may now be async too, and a hook that throws no longer reaches the request: askdare logs its error's name instead.

### Patch Changes

- 7c9fb36: Source links under an answer are checked like links inside it: only `http`, `https` and `mailto` URLs become links, and anything else shows as plain text. Before, they relied on the protocol validator alone.
- 45ef7de: Fixes in the chat inside a page and its default look:
  
  - An answer or a transcript returns focus to the message field only when focus was in the chat or nowhere, never from the page's own fields, and without scrolling the page. `actions.focus()` still always moves it.
  - Ratings of one answer go out one at a time: quick 👍 then 👎 ends with what the server took, and a failed one goes back to the last rating it confirmed.
  - A comment after 👎 stays in its form until it is sent, so a failed send no longer loses the text.
  - No new dictation starts while the last one is being transcribed.
  - `<Root>` unmounting stops the answer being streamed and the uploads still running.
  - `Composer`: an `onSubmit` that calls `preventDefault()` takes the message over, Enter in the `Input` goes through `onSubmit` too, and an `onPaste` that prevents the default keeps the files out.
  - Escape outside the chat is left to the page also with `headingLevel={1}`, and Escape that a handler already used is ignored. The question before a new conversation is modal only in the iframe.
  - The default look's stylesheet styles only the chat inside `DefaultChat`, never a headless chat in the same document.
  - The rating buttons and the question after 👎 scroll into view at the end of the conversation, and messages no longer re-render on every change of the chat.

## 0.1.0

### Minor Changes

- da333a2: First release of askdare: an AI chat for any website, served by your Next.js app and built on the official OpenAI SDK (Responses and Conversations APIs). It succeeds `@boldare/openai-assistant`, which stopped working when OpenAI shut down the Assistants API.
  
  - **Integration:** a bot in `askdare.config.ts` (`defineBot`), one catch-all route (`createChatHandler`) and one script tag on any website (`widget.js?bot=<id>`). `npx @boldare/askdare init` sets it up, and `npx @boldare/askdare doctor` checks the key, models, vector store, headers and allowed sites, locally or deployed.
  - **Embedding:** a small loader and an isolated iframe served by your app, shown only on the sites in `security.allowedOrigins`. As a bubble, behind your own button (`data-launcher="none"`) or inside the page (`data-mode="inline"`), driven by `askdare('open' | 'close' | 'toggle' | 'configure' | 'identify')`.
  - **No database:** conversations live in OpenAI's Conversations API, and the browser keeps an encrypted resume token. Visitors can start a new conversation, which deletes the old one and its files.
  - **Knowledge base:** `npx @boldare/askdare kb sync <folder>` mirrors your documents to a vector store, and answers cite your pages.
  - **Tools:** `defineTool` with Zod schemas, validated arguments, timeouts and output limits. Tools see only verified context.
  - **Attachments and voice:** images and PDFs (checked by their bytes, re-encoded in the browser, referenced by encrypted handles), and dictation into the message field.
  - **Signed-in visitors:** `askdare('identify', token)` with a JWT your backend signs.
  - **Safety and cost:** short-lived encrypted sessions; rate limits; daily token and speech budgets per visitor, IP, bot and app, reserved per model call; a kill switch; sanitized Markdown; no cookies; no message content in logs; `onError` for your monitoring. In development, the chat and the log say what is wrong with the setup.
  - **Look:** four themes (Aura, Halo, Sage, Care) in light and dark, your own with `defineTheme`, `--ask-*` tokens and `data-ask-part` parts for your CSS, English and Polish texts with overrides for every key, and an AI disclosure. Keyboard, focus and screen reader support, checked with axe.
  - **Docs in the package:** the guides (`docs/`), `llms.txt` and a skill for AI coding agents (`skills/askdare`), always matching the installed version.
  
  For limits shared across several server instances, add `@boldare/askdare-upstash`.

### Patch Changes

- 3bf0dd0: Requires `openai` 7.52.0 and `jose` 6.2.15 or newer. Nothing changes in how askdare calls the API or signs tokens.
- ef92f7a: Closing the chat from inside it returns keyboard focus to the page in Firefox too, not only in Chromium. `doctor` and `init` no longer report `.env.local` as not ignored in a project without git when its `.gitignore` has folder negations such as `!.yarn/patches`, as create-next-app's does.
- 13259d4: When the chat opens with a stored conversation and the server refuses the session, it shows the server's reason (explained in development) instead of "Could not load the previous conversation." The conversation stays stored for the next try.
- 4b7512b: The launcher's label is a part, `launcher-label`, so a site can hide it on small screens and show only the orb or picture (see Styling). A chat placed in the page (`data-mode="inline"`) no longer sits above the page's own fixed elements, such as a sticky header or a bottom bar.
- 342a931: Requires the `openai` SDK 7.51.0 or newer (was 7.45.1). Nothing changes in how askdare calls the API.
- 9d4a548: The README is shorter, with three steps to a working chat and a map of the guides. Getting started explains how AI coding agents use the docs and the skill in the package.
- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.
- 4b9cfed: The chat window is built with Preact 11. It looks and works the same.

## 0.1.0-rc.4

### Patch Changes

- 3bf0dd0: Requires `openai` 7.52.0 and `jose` 6.2.15 or newer. Nothing changes in how askdare calls the API or signs tokens.
- 9d4a548: The README is shorter, with three steps to a working chat and a map of the guides. Getting started explains how AI coding agents use the docs and the skill in the package.
- 4b9cfed: The chat window is built with Preact 11. It looks and works the same.

## 0.1.0-rc.3

### Patch Changes

- 4b7512b: The launcher's label is a part, `launcher-label`, so a site can hide it on small screens and show only the orb or picture (see Styling). A chat placed in the page (`data-mode="inline"`) no longer sits above the page's own fixed elements, such as a sticky header or a bottom bar.
- 342a931: Requires the `openai` SDK 7.51.0 or newer (was 7.45.1). Nothing changes in how askdare calls the API.

## 0.1.0-rc.2

### Patch Changes

- f25bb19: Docs: a database from the Vercel Marketplace (Upstash for Redis) sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, and one from the Upstash console has the `UPSTASH_REDIS_REST_*` names. The store reads both, as before.
- 68d94e6: The npm pages link to the website, https://askdare.vercel.app, with the docs and a live demo of every theme.

## 0.1.0-rc.1

### Patch Changes

- 13259d4: When the chat opens with a stored conversation and the server refuses the session, it shows the server's reason (explained in development) instead of "Could not load the previous conversation." The conversation stays stored for the next try.

## 0.1.0-rc.0

### Minor Changes

- da333a2: First release of askdare: an AI chat for any website, served by your Next.js app and built on the official OpenAI SDK (Responses and Conversations APIs). It succeeds `@boldare/openai-assistant`, which stopped working when OpenAI shut down the Assistants API.
  
  - **Integration:** a bot in `askdare.config.ts` (`defineBot`), one catch-all route (`createChatHandler`) and one script tag on any website (`widget.js?bot=<id>`). `npx @boldare/askdare init` sets it up, and `npx @boldare/askdare doctor` checks the key, models, vector store, headers and allowed sites, locally or deployed.
  - **Embedding:** a small loader and an isolated iframe served by your app, shown only on the sites in `security.allowedOrigins`. As a bubble, behind your own button (`data-launcher="none"`) or inside the page (`data-mode="inline"`), driven by `askdare('open' | 'close' | 'toggle' | 'configure' | 'identify')`.
  - **No database:** conversations live in OpenAI's Conversations API, and the browser keeps an encrypted resume token. Visitors can start a new conversation, which deletes the old one and its files.
  - **Knowledge base:** `npx @boldare/askdare kb sync <folder>` mirrors your documents to a vector store, and answers cite your pages.
  - **Tools:** `defineTool` with Zod schemas, validated arguments, timeouts and output limits. Tools see only verified context.
  - **Attachments and voice:** images and PDFs (checked by their bytes, re-encoded in the browser, referenced by encrypted handles), and dictation into the message field.
  - **Signed-in visitors:** `askdare('identify', token)` with a JWT your backend signs.
  - **Safety and cost:** short-lived encrypted sessions; rate limits; daily token and speech budgets per visitor, IP, bot and app, reserved per model call; a kill switch; sanitized Markdown; no cookies; no message content in logs; `onError` for your monitoring. In development, the chat and the log say what is wrong with the setup.
  - **Look:** four themes (Aura, Halo, Sage, Care) in light and dark, your own with `defineTheme`, `--ask-*` tokens and `data-ask-part` parts for your CSS, English and Polish texts with overrides for every key, and an AI disclosure. Keyboard, focus and screen reader support, checked with axe.
  - **Docs in the package:** the guides (`docs/`), `llms.txt` and a skill for AI coding agents (`skills/askdare`), always matching the installed version.
  
  For limits shared across several server instances, add `@boldare/askdare-upstash`.
