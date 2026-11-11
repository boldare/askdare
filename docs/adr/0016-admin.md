# ADR-0016: Admin: a console first, then an add-on with storage

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Once a bot is live, its owner wants to see it from the inside: which configuration is running, whether OpenAI accepts it, what the model is really told, what a turn costs, how visitors rate the answers and what went wrong in the badly rated conversations.

What exists today:
- **`askdare doctor`** checks every bot live (model, vector store, transcription model) through `/doctor`, behind a token derived from `CHAT_SECRET`. It prints to a terminal.
- **`onUsage` and `onFeedback`** ([ADR-0012](0012-server-hooks-and-telemetry.md)) hand each turn's cost and each rating to the app, without message content. askdare stores neither.
- **No database** ([ADR-0003](0003-conversation-state.md)). The OpenAI Conversations API can't list conversations, so askdare can't browse them either.
- **No content or PII in logs, no cookies** ([ADR-0004](0004-threat-model.md)), and the server configuration (model, instructions, tools, vector stores) never reaches a browser ([ADR-0008](0008-ui-customization-and-themes.md)).

Some of what owners want needs no storage at all (configuration, checks, a playground). Dashboards and reviews over time do. This ADR fixes the shape of both, so the core work in 0.3 doesn't close doors. Implementation comes later.

## Decision

### Stage 1: a console without a database

A console route served by the chat handler, off by default.

- **What it shows:**
  - each bot's configuration as the server resolved it, secrets masked, with its texts per language ([ADR-0014](0014-runtime-language.md));
  - the `doctor` results, run from the page;
  - a playground: send a message as a test visitor and see the resolved instructions (with the per-request context filled in), the tools offered on each step (the reserved `suggest_replies` included, [ADR-0015](0015-reply-options.md)), the steps taken and the turn's cost from the same report `onUsage` gets;
  - a set of test questions per bot, run one by one or all at once, with the answers side by side for a manual check.
- **The test questions come from configuration** (`defineBot` or the console's options), never from files read at runtime.
- **Nothing is stored.** Results live in the page until it's closed.
- **Access:** the console shows what ADR-0008 keeps from browsers, so it is protected by either:
  - a secret, as `/doctor` is today (a token derived from `CHAT_SECRET` or a separate admin secret), entered in the page and kept in memory; or
  - the site's identity ([ADR-0009](0009-visitor-identity.md)): a signed-in user whose ID is on an allowlist in the server configuration.

  No cookies, as everywhere else: the console sends a Bearer token on each request. Its pages are `no-store` and `frame-ancestors 'none'`.
- **Playground turns are real turns.** They cost money, so they go through the bot's budgets and limits like any other turn, and appear in `onUsage`.

### Stage 2: `@boldare/askdare-admin`

An add-on for owners who want history: dashboards and reviews.

- **An `AdminStore` port,** shaped like `RateLimitStore`: a small interface, a contract test suite every implementation runs, and official implementations for **Postgres** and **Upstash**. The core keeps no database.
- **It is fed by server hooks:**
  - `onUsage` for cost, latency and tool calls (ADR-0012);
  - `onFeedback` for ratings and comments (ADR-0012);
  - a new **`onTranscript`** hook in the core: opt-in, called after each turn with the visitor's text and the answer, plus the same identifiers `onFeedback` gets. It is the only hook that carries content, and nothing calls it unless the app sets it.
- **What it shows:**
  - cost per bot, per day and per model, and the most expensive conversations (by pseudonym);
  - ratings over time, and the 👎 answers with their comments;
  - a review of a 👎 conversation: the stored transcript, or, without `onTranscript`, the conversation fetched from OpenAI by the ID `onFeedback` received.
- **`AdminStore` is not a conversation store.** It holds reports, ratings and optional transcripts for the owner. Conversation state stays behind `ConversationStore` (ADR-0003); a Postgres conversation store remains a separate add-on.

### Rules for both stages

- **Admin access is checked by askdare on every request,** on top of whatever the app's own auth does. The app can mount the admin behind its own sign-in, but askdare doesn't rely on it.
- **GDPR:**
  - retention is configured, with a default, and older records are deleted;
  - deleting a conversation (`DELETE <basePath>/conversation`, ADR-0003) also deletes its transcript and ratings from the `AdminStore`;
  - records are keyed by pseudonyms (HMACs, ADR-0012), never by IP addresses or raw visitor IDs;
  - `docs/privacy.md` covers what the add-on stores, and the app's privacy notice must too.
- **No content in logs.** Transcripts are stored data, never logged. The store implementations log nothing about the values they write.

## Consequences

- **The core stays database-free.** Stage 1 needs only `CHAT_SECRET`; stage 2 is opt-in, with its own package and storage.
- **New public API, when built ([ADR-0006](0006-support-matrix-and-versioning.md)):**
  - the console option and its access settings (stage 1);
  - `onTranscript` and its report type in the core (stage 2);
  - the `AdminStore` port and the add-on (stage 2).
- **The console is the first page that shows server configuration in a browser.** It gets a security review before it ships, and `THREAT_MODEL.md` a section.
- **`onTranscript` moves content out of OpenAI** into storage the owner runs. That is the point (retention, export, independence from OpenAI, as ADR-0003 promised for own storage), and also why it's opt-in.
- **Reviews without transcripts depend on OpenAI** keeping the conversation, so they end when the visitor deletes it.

## Alternatives considered

- **A hosted dashboard run by Boldare.** Conversations and costs would leave the owner's infrastructure, and askdare would need accounts and a backend of its own.
- **Admin in the core, with a database.** It breaks ADR-0003's promise that two environment variables are enough.
- **Only the OpenAI dashboard.** It shows cost per project and key, not per bot or conversation, has no ratings, and can't list conversations.
- **Only the OpenTelemetry add-on (ADR-0012).** Good for cost and latency in tools teams already use, and it stays; it has no ratings or transcripts and no place to review a conversation.
- **Ratings and notes in OpenAI conversation metadata.** 16 keys per conversation, and it can't be queried (ADR-0012).
- **Stage 2 only.** The console answers the first questions after launch (what is running, does it work, what does it cost) without any storage, so it comes first.
