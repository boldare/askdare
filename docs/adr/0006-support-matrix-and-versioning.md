# ADR-0006: Support matrix and versioning policy

- **Status:** Accepted. The size budget of `@boldare/askdare/react` is superseded by [ADR-0023](0023-human-check-and-react-budget.md) and [ADR-0028](0028-react-budget-34-kb.md); the Zod and Node.js rows and the exports of 0.5 by [ADR-0020](0020-public-api-cleanup-0-5.md). The 0.6 surface was added to the list on 2026-11-25, and the 0.7 surface on 2026-11-27 (tasks z1); the loader's budget is ADR-0033's.
- **Date:** 2026-10-29

## Context

A library runs inside its users' apps, so every supported combination of versions is a promise. A narrow, published matrix is the cheapest way to keep that promise.

## Decision

### Support matrix

| Area | Supported | Not supported |
|---|---|---|
| Node.js | 22 and 24 (`engines: >=22`) | 20 or older (end of life) |
| Next.js | 16.x, latest minor (peer `^16`), App Router, Node.js runtime | Pages Router, Edge runtime, static export |
| React | 19 in your app. The script-tag widget needs no React: it is a prebuilt iframe app. `@boldare/askdare/react` (0.2, ADR-0011) has the optional peer `^19`. | 18 |
| Zod | `^4.1` (peer, required) | 3 |
| Bundlers | Turbopack (default) and `next build --webpack` | |
| Consumer TypeScript | 5.9, 6.0 and 7.0 (published `.d.ts` tested against each) | |
| Hosting | Vercel and Heroku, both documented and smoke-tested | Others are unsupported but expected to work if they run `next start` |

### Versioning (0.x)

- **Minor** releases may break; **patch** releases never do.
- A removal is preceded by a deprecation warning one minor earlier.
- Every change carries a changeset.
- The SSE protocol has its own version (`x-askdare-protocol`).
- **The public surface is exactly:**
  - `defineBot` (with its `embedPath` option, ADR-0018), `defineTool` (with its `replies` and `ui` options, and the `Name` and `Ui` type parameters of `Tool`, ADR-0017), `createChatHandler` (and `defineTheme`);
  - `getChatConfig`, `getEmbedConfig` and `embedPageHeaders` (ADR-0018), and everything `@boldare/askdare/react` exports: `Root`, `DefaultChat`, `Theme`, the hooks and the primitives (ADR-0011);
  - the `data-askdare-root` attribute of the theme root;
  - the script tag's `data-*` attributes (`data-follow-lang` included) and the `askdare()` JS API, `identify`, `on`, `off` and `configure({ locale })` included (ADR-0014);
  - the chat event catalog and `Root`'s `onEvent` (ADR-0013);
  - `BotHandle`, `ERROR_CODES`, `ErrorCode` and `PROTOCOL_VERSION` from `.` (ADR-0020);
  - the built-in tool names `defineBot` reserves: `file_search`, `suggest_replies` (ADR-0015), `search_knowledge` (ADR-0025), `handoff` (ADR-0030) and `show_form` (ADR-0031);
  - the identity token's claims, `IDENTITY_SECRET` and `context.identity` (ADR-0009);
  - `--ask-*` tokens, `data-ask-part` names and dictionary keys;
  - the shadow parts on the host page (`launcher`, `panel`, `unavailable` and, from 0.7, `greeting`), the launcher's `data-unread` attribute (the unread badge, drawn by `::part(launcher)::after`) and the host element's `data-askdare` attribute;
  - the protocol version, and its events and history fields (`replies` from ADR-0015, `tool.ui` and `ui` from ADR-0017), the `before` cursor of `POST /history` and its answer (ADR-0024), the SSE `id:` of every event frame and `POST /resume` (ADR-0027); from 0.7, the `handoff` and `form` events, the history fields `handoff` and `forms`, the public configuration's `forms` and `handoff`, `POST /handoff`, and `POST /forms` with its answers and error keys (ADR-0030, ADR-0031);
  - **conversation stores** (ADR-0024, ADR-0029): the `conversations` option of `createChatHandler`; the `ConversationStore` port with `ConversationOwner`, `ConversationInfo`, `ConversationContext`, `ConversationPage`, `ConversationStoreCheck`, `StoredItem` (with `kind` on `native` items), `StoredPart`, `StoredCitation`, `PositionedItem`, `CompactionModel` and `VersionConflictError`; `memoryConversations` from `.`; `openaiConversations` and `OpenAIConversationsOptions` from `./next`, since they need `openai`;
  - **knowledge on your own index** (ADR-0025): `knowledge.index` and `knowledge.maxResults` in `defineBot`; the `KnowledgeIndex` and `Embedder` ports with `KnowledgeDocument`, `KnowledgeChunk`, `Passage`, `SyncReport`, `SearchOptions`, `KnowledgeCallOptions`, `KnowledgeCheck` and `Embeddings`; `openaiEmbedder` and `OpenAIEmbedderOptions`; and, for index adapters, `checkKnowledgeDocuments` and `embeddingInput`;
  - **resuming answers** (ADR-0027): the `resume: { log }` option of `createChatHandler`, typed `ChatHandlerResumeOptions`; the `TurnEventLog` port with `TurnEvent`; `memoryTurnLog`, `MemoryTurnLog` and `MemoryTurnLogOptions`. The batching writer and the log's key stay internal: only the server writes turns;
  - **compaction** (ADR-0029): `limits.compactAt`, and `ChatUsageReport.compaction` with `ChatCompactionReport`;
  - **transcripts** (ADR-0016): the `onTranscript` hook with `ChatTranscriptReport` and `ChatTranscriptCitation`;
  - **handoff to a human** (ADR-0030): from `.`, `handoff` in `defineBot` (`true`, or `HandoffConfig` with `HandoffLimits` and `HandoffAvailabilityContext`); from `./next`, `onHandoff` with `ChatHandoffReport` and `ChatHandoffMessage`, and the transports `webhookHandoff` (with `WebhookHandoffOptions`; its Standard Webhooks headers and JSON body, which is the report) and `emailHandoff` (with `EmailHandoffOptions` and `HandoffEmail`); in `@boldare/askdare/react`, `HandoffButton` (part `handoff`), `HandoffStatus` (part `handoff-status`), `HandoffState` and the `handoff` action;
  - **forms and leads** (ADR-0031): from `.`, `defineForm` with `Form`, `FormDefinition`, `FormField`, `FormFieldType` and `FormText`, and `forms` in `defineBot`; from `./next`, `onLead` with `ChatLeadReport`; in `@boldare/askdare/react`, the `Form` primitive (with `FormProps`; parts `form`, `form-title`, `form-field`, `form-optional`, `form-error`, `form-submit` and `form-done`), `ChatForm`, `ChatFormField`, `ChatFormOption`, `FormFieldType`, `FormPurpose`, `MessageForm`, `bot.forms` and the `submitForm` action. askdare stores no form values: what reaches `onLead` and `onHandoff` is the app's;
  - **admin** (ADR-0032): from `.`, the `AdminStore` port with `AdminRecordKey`, `AdminSource`, `AdminTurnRecord`, `AdminCheckOutcome`, `AdminRatingRecord`, `AdminStoredRating`, `AdminTranscriptRecord`, `AdminTranscriptCitation`, `AdminCountEvent`, `AdminHandoffState`, `AdminHandoffCounts`, `AdminRange`, `AdminDayRow`, `AdminBotDayRow`, `AdminDays`, `AdminConversationSummary`, `AdminConversationQuery`, `AdminRatingQuery`, `AdminPage`, `AdminSweepOptions` and `AdminWriteOptions`; `memoryAdminStore`; `AdminDashboard` with `AdminDashboardHandler` and `AdminDashboardRequest`, the one core type that exists for `@boldare/askdare-admin`. From `./next`, the `admin` option of `createChatHandler` (`ChatHandlerAdminOptions` and `ChatHandlerAdminConsoleOptions`) and `sweep` on the returned handlers (`ChatSweepOptions`, `ChatSweepResult`). `ADMIN_SECRET`, the console's page at `<basePath>/admin` and its identity sign-in (an identity token with the audience `askdare:admin`, passed as `#identity=<jwt>`). The console's API actions, their JSON, its page's code and the dashboard's mount contract are internal: core and the add-on change them together;
  - **the greeting and the unread badge** (ADR-0033): `widget.launcherGreeting` (`true`, or `{ delaySeconds }`), the script tag's `data-greeting="off"`, and the browser events `greeting.shown` and `greeting.dismissed`. The `sessionStorage` key the loader writes is listed in `docs/privacy.md` but is not API;
  - **older messages** in `@boldare/askdare/react`: `LoadEarlier` (with `LoadEarlierProps`), `ChatState.earlier` (type `Earlier`) and the `loadEarlier` action, already covered by "everything `@boldare/askdare/react` exports";
  - **`@boldare/askdare/testing`**: the contract suites `adminStoreContract`, `conversationStoreContract`, `knowledgeIndexContract`, `rateLimitStoreContract` and `turnEventLogContract`, each called as `(name, create, { describe, it, expect, …options })`, with `ContractRunner`, `ContractExpect`, their options types (`AdminStoreContractOptions` included) and `OpenKnowledgeIndex`; the fixtures `fakeEmbedder` and `knowledgeDocument` (with `FakeEmbedderOptions` and `KnowledgeDocumentInput`). Which tests a suite runs may grow in a minor release, as the port's behaviour is specified more closely;
  - ports implemented by official add-ons: `RateLimitStore` (and `CounterHit`), `ConversationStore`, `KnowledgeIndex`, `TurnEventLog` and `AdminStore`;
  - **the official add-ons' exports:**
    - `@boldare/askdare-upstash`: `upstashStore`, `UpstashStoreOptions`, `RedisEval`, `upstashTurnLog`, `UpstashTurnLogOptions`, `upstashAdminStore` and `UpstashAdminStoreOptions`. Key names are not API;
    - `@boldare/askdare-postgres`: `postgresConversations`, `pgvectorIndex` and `PgvectorIndexOptions`, `postgresAdminStore` and `PostgresAdminStoreOptions`, `migrate` with `MigrateOptions`, `MigrateReport` and `AppliedMigration`, the connection types `PostgresConnectionOptions`, `PostgresPool`, `PostgresPoolClient` and `PostgresQueryResult`, the `askdare-postgres migrate [part…]` command and its part names (`conversations`, `admin`, `knowledge`). The tables are not API: they change only through `migrate`, and their names start with `askdare_`;
    - `@boldare/askdare-otel`: `otelUsage` and `OtelUsageOptions`;
    - `@boldare/askdare-admin` (ADR-0032): `adminDashboard`, `AdminDashboardOptions`, `AdminPrices` and `AdminModelPrice`. The dashboard's handler actions, their JSON and its browser app are internal: core and the add-on change them together, behind `AdminDashboard`;
  - the `askdare` commands and their options (`init`, `doctor`, `kb sync` with `--index`, `--embedding-model` and `--dimensions` and their variables `ASKDARE_EMBEDDING_MODEL` and `ASKDARE_EMBEDDING_DIMENSIONS`, `add ui`), but not their printed output or the `/doctor` report behind `doctor`. The files `add ui` copies are the user's code from then on: their content is not API;

  Everything else is internal.
- **Guards** (published for users in [Support](../support.md)):
  - a `.d.ts` snapshot (`packages/askdare/api/askdare.api.txt`) fails the check when the published types change, until it is updated on purpose with a changeset; a consumer project type-checks the published `.d.ts` with TypeScript 5.9, 6.0 and 7.0;
  - size budgets fail the build: loader 5.5 KB (ADR-0033), chat app 50 KB, its styles 8 KB, each preset's fonts 82 KB, the admin console 30 KB (ADR-0032), and `@boldare/askdare/react` 34 KB in an app's bundle, 12 KB for a page that uses only `Root` and `useChat`, or 14 KB for `EmbedRoot` (ADR-0028; all gzipped); the admin dashboard's script 12 KB and its styles 4 KB (gzipped, in `@boldare/askdare-admin`);
  - a nightly canary runs the checks and browser tests against `next@canary` and `openai@latest` (with the mocked OpenAI API);
  - a daily live smoke test runs on a cheap model in a dedicated, spend-capped OpenAI project, so a retired model or a changed API fails there.

## Consequences

- Issues from unsupported setups are closed with a link to this ADR.
- Upgrading the Next.js or React major is a deliberate, planned change, not something that breaks unexpectedly.
