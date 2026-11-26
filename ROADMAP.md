# Roadmap

Where askdare is going, release by release. This file holds the direction only:
- **Decisions** that are expensive to reverse are [Architecture Decision Records](docs/adr/README.md).
- **Tasks and their status** live in [`tasks/`](tasks/README.md), one file per task.

A change to what a release contains comes as a pull request to this file.

## Direction

askdare is the website chatbot a team owns in code: self-hosted in their Next.js app, safe for anonymous visitors, compliant with AI transparency and accessibility rules out of the box, with the features buyers expect from hosted support bots (handoff, leads, analytics) and no fee per resolved conversation.

- **What we don't compete on:** chat UI primitives. AI SDK, AI Elements and assistant-ui own that space; askdare interoperates with them instead (0.9).
- **How releases are cut:** each minor tells one story. Breaking changes stay allowed in 0.x ([ADR-0006](docs/adr/0006-support-matrix-and-versioning.md)), and 1.0 comes after real production use, not on a date.
- **How decisions change:** an accepted ADR is never rewritten. A new ADR supersedes or extends it and says why.

## Released

- **0.2.0, the chat inside your page:** the headless React API and inline chat (ADR-0011), `add ui`, answer ratings, `onUsage` and the OpenTelemetry add-on (ADR-0012), browser events (ADR-0013).
- **0.3.0, talk in more ways:** one-click deploy for Vercel, reply options (ADR-0015), runtime language step 1 (ADR-0014).
- **0.4.0, settle in:** texts per language and switching language in place (ADR-0014), tool cards with `toolRenderers` (ADR-0017), your own page in the widget's iframe with `embedPath` and `EmbedRoot` (ADR-0018).
- **0.5.0, compliance-ready:** the AI notice everywhere with the `Disclosure` primitive, WCAG 2.2 AA with a conformance statement, opt-in moderation and guardrails (ADR-0019, ADR-0022), an optional Turnstile human check and `limits.requireSharedStore` (ADR-0023), built-in Czech, German, Spanish, French and Italian, a compliance guide, and the public API clean-up: `BotHandle`, exported `ERROR_CODES`, Node.js 26 (ADR-0020, ADR-0021). Also the 0.4.x hygiene: error logs without visitor text, faster streaming Markdown, `doctor` warning about model shutdown dates, and a clear error for context overflow.

- **0.6.0, own your data:** a `ConversationStore` port with OpenAI Conversations as the default, `memoryConversations()` and the Postgres add-on `@boldare/askdare-postgres`, so turns replay with `store: false` and zero-data-retention setups work (ADR-0024); a retrieval port with pgvector behind the `search_knowledge` tool and `askdare kb sync` to either index (ADR-0025); both split out of `ModelGateway` (ADR-0026); history paged beyond 100 items; resuming an answer after a dropped connection, with the Upstash turn log (ADR-0027); opt-in compaction for your own store (ADR-0029); the `onTranscript` hook (ADR-0016).

## 0.6.x: patches

What the 0.6 review left open and fits in a patch, from "Known gaps" below, done in parallel before the 0.7 tasks and merged into `main`: h1, resume after sign-in (#192); h2, no rating for a replaced answer (#196); h3, `doctor`'s store timeout (#193); h4, an index for the Postgres compaction lookup (#190); h5, regional endpoints documented (#194). Two pieces stay open in "Known gaps": the chat-client half of h1, and a contract run against the EU endpoint, which needs a key from an EU-residency project. The merged patches ship in the next 0.6.x release.

## 0.7: support-grade

The features buyers compare against Intercom Fin and Chatbase. Planned on 2026-11-26: the decisions come first as ADR-0030 to ADR-0033 (tasks x1 to x4), the tasks are in [`tasks/`](tasks/README.md) and their order is under "Lanes and hot files" below.
- **Handoff to a human** (ADR-0030): a `handoff` tool, a "connecting you" state in the chat, and an `onHandoff` hook. Email and webhook first; live agent chat stays with the 0.9 adapters.
- **Forms in the chat** (ADR-0031): leads into `onLead`, with fields defined on the server and validated there, built on reply options and tool cards. A handoff with nobody available falls back to a form.
- **Admin** (ADR-0016, extended by ADR-0032): stage 1, the console with no database, then stage 2, `@boldare/askdare-admin` on an `AdminStore` port with Postgres and Upstash implementations, with transcripts, ratings, unanswered questions, cost per conversation and resolution rate. Deleting a conversation, by the visitor or a sweep, then deletes its transcripts and ratings too; 0.6 calls no hook on delete.
- **Proactive greeting and an unread badge** (ADR-0033). The loader is at 5,016 of its 5,120 bytes (gzipped), so spike S10 first measures how to make it smaller or move logic into the iframe. The React entry needs no room made first: task b1 measured it on 2026-11-26 (`scripts/react-size.mjs`, `release/0.7` at a70bbf8) at 31,678 of 34,816 bytes for the whole entry, 11,311 of 12,288 for the headless case (`Root` and `useChat`) and 12,074 of 14,336 for the embed, after `marked` was cut to its lexer in 0.6.x. The headless case, with 977 bytes left, is the tight one: c2's state grows it, and size work in `chat/store.ts` and `chat/chat-client.ts` found under 400 bytes without dropping behavior, since gzip already absorbs their repetition.

## 0.8: quality and reach

- **`askdare eval`:** regression tests for answers and citations, run in CI. 👎 conversations from admin become test cases. OpenAI's own Evals go read-only on 2026-11-30. It starts from spike S8's questions and grading (`spikes/s8-retrieval/`), plus a harder set: 100 or more documents, questions across languages, multi-turn follow-ups and PDFs. S8's set showed parity between `file_search` and our own retrieval, not a margin.
- **Prompt versions and A/B tests** in `defineBot`.
- **More tools:** remote MCP tools, an `httpTool` preset, `web_search` as a fallback when `file_search` finds nothing, and approving a tool call in the chat.
- **Model settings:** reasoning effort and verbosity, passed through and checked per model, with no model IDs in the library.

## 0.9: open

- **A second provider path** ([ADR-0026](docs/adr/0026-provider-path.md)): OpenRouter as a stateless provider profile of the existing OpenAI gateway, on 0.6's own store and retrieval. A profile carries its capabilities, the request fields its provider needs (such as `cache_control` for prompt caching), the forced-last-step note and an error classifier. Support covers verified models only, listed in the docs: Claude Haiku 5.5 passed spike S6b, `gpt-oss-120b` did not.
- **Verify Hugging Face and local servers** for a profile each: rerun the S6b probes in `spikes/s6b-open-responses/` with a funded Hugging Face account (about 5 USD) and, for Ollama or another local server, on a machine that can run a model with tools. What to look at: errors that arrive as HTTP 200 with `response.failed`, and Hugging Face refusing `allowed_tools`. S6b couldn't run either (402 without credits; the 16 GB laptop froze), so they are not verified, not rejected.
- **Native adapters** (Claude first, as `@boldare/askdare-anthropic`) stay an option for when a client needs them, under ADR-0026's conditions: a public `ModelGateway` port, reply options before the answer, and no voice or moderation.
- **Interop:** expose the chat stream to AI SDK UI messages or AG-UI, so those ecosystems can use askdare's backend.
- **Handoff adapters:** Slack, HubSpot and Zendesk.

## 1.0: stable

API freeze, a support policy and a migration guide from 0.x. We cut 1.0 once two or three teams have run 0.7 or later in production and two minors have shipped without breaking the API.

## Known gaps

What 0.6 leaves open, found by its tasks and reviews. Each line names where it goes; a release that takes one moves it into its own section.

**Data that still reaches or stays at OpenAI** ([own your data](docs/own-your-data.md#what-stays-at-openai)):
- **Attachments** are stored in OpenAI Files until they expire (30 days) or the conversation is deleted, and Files isn't eligible for Zero Data Retention. This is the one exception to "nothing kept at OpenAI" with your own store and ZDR. Next step: a file store port with an S3-compatible add-on, so attachments are sent inline and kept in your own bucket. Later, after 0.7.
- **Regional endpoints: no live run yet.** `OPENAI_BASE_URL` points every askdare client at a regional endpoint, and [Deployment](docs/deployment.md#regional-openai-endpoints) says what OpenAI's EU endpoint covers (everything askdare calls except the default Conversations API). Probed on 2026-11-26 with a Global project's key: the EU host routes, but answers 401 on responses and conversations without a residency project. The full contract and smoke run still waits for a key from an EU-residency project, which needs OpenAI's sales team ([Live testing](docs/live-testing.md#against-a-regional-endpoint)). 0.6.x, as soon as a key is available.
- **No model request without OpenAI** until another provider path exists. 0.9 ([ADR-0026](docs/adr/0026-provider-path.md)).

**Privacy and security** (low-confidence notes from the `release/0.6` security review, worth a closer look):
- **Transcripts outlive a deleted conversation:** deleting one calls no hook, so a transcript an app keeps through `onTranscript` stays until the app sweeps it. 0.7, with the admin store ([ADR-0016](docs/adr/0016-admin.md)); an `onConversationDeleted` hook is the fallback if that slips (task c5).
- **An answer's live stream can hand back an anonymous resume token** when the visitor signs in while it streams and it doesn't drop; the chat client stores it in the user's place, where it outlives sign-out until the next answer. `POST /resume` no longer replays it (0.6.x, h1); the rest is a chat-client fix. 0.6.x.

**Smaller items:**
- "Reconnecting…" can stay visible after a successful resume until the next text or status event. 0.7, in task c2.
- A message sent at the moment a compaction is stored gets a "please wait" error (documented in [ADR-0029](docs/adr/0029-compaction-for-item-stores.md)). Later.
- No sweep helper in core: a site's cron route deletes files with the `openai` SDK itself ([own your data](docs/own-your-data.md)). 0.7, with the admin store; ADR-0032 (task x3) decides whether core gets one.

## Later

Ordered when a release is planned:
- other channels (Slack, Teams, WhatsApp) through a chat SDK;
- voice conversations;
- native adapters for other model providers (ADR-0026);
- PDF, DOCX and PPTX on the own knowledge path, built in or through an extractor the site supplies (ADR-0025);
- searching before the turn without a tool, and an in-process knowledge index for small static sites (ADR-0025);
- adopting an anonymous conversation at sign-in (`reassign`, ADR-0024), and a Postgres turn log (ADR-0027);
- right-to-left layouts;
- business hours, copying and exporting a conversation;
- a `CustomEvent` for GTM ([ADR-0013](docs/adr/0013-browser-events.md)).

## How we track work

- **Tasks live in the repository,** in [`tasks/`](tasks/README.md): one file per task, with its status, lane and dependencies. Only the next release gets task files; anything further out is a section or a line above.
- **The task file is the whole brief** for whoever picks it up, person or agent: the goal, the ADRs to read, the files it may touch and those it must not, the Definition of Done and the tasks it depends on.
- **The pull request that finishes a task deletes its file,** so `tasks/` lists only open work.
- **GitHub issues are for users:** bug reports and feature requests. Roadmap work doesn't go there.

### Lanes and hot files

Work runs in parallel lanes. A **hot file** is changed by one task at a time, because those files meet in every feature; tasks that share none can run side by side. Paths are under `packages/askdare/src/`:
- `protocol/*` and `docs/protocol.md`;
- `chat/state.ts`, `chat/reducer.ts`, `chat/store.ts` and `chat/events.ts`;
- `bot/define-bot.ts`;
- `i18n/texts.ts`;
- `react/headless.ts`;
- `embed/loader.ts`, which has a 5 KB budget;
- `i18n/locales/*`, changed together with `i18n/texts.ts`;
- `server/handler.ts`, which every 0.7 feature mounts into.

Two shared files don't make a task hot:
- **The API snapshot** (`api/askdare.api.txt`) is generated. A task that changes the public API rebases and regenerates it (`pnpm --filter @boldare/askdare api:update`) instead of merging it by hand.
- **ADR-0006** is updated once per release, by its z1 task, from the public surface the release's ADRs list. Other tasks don't edit it.

New ADRs written at the same time take numbers reserved in their task files (0030 to 0033 for 0.7), so parallel pull requests don't collide.

| Lane | What runs in it | Hot files |
|---|---|---|
| Organization | The roadmap and `tasks/` | No |
| Hygiene | 0.6.x patches on `main` | No |
| CI | Workflows, visual baselines, the starter check; 0.7-e1 | No |
| Decisions | ADRs 0030 to 0033 (0.7-x1, x2, x3), accepted or amended by the tasks that build them; 0.7-z1 | No |
| Spikes | 0.7-x4 (S10, the loader) | No |
| Docs | 0.7-d1 | No |
| Ports | New modules inside `packages/askdare` that no hot file reaches yet: 0.7-p1 (`handoff/`), p2 (`admin/`), p3 (`forms/`) | No |
| Add-ons | 0.7-a1 (`askdare-postgres/src/admin/`), a2 (`askdare-upstash/src/admin/`), a3 (the new `askdare-admin` package) | No |
| Loader | 0.7-l1, l2: `embed/loader.ts`, which no other task changes | l1 alone; l2 also `bot/define-bot.ts` |
| Core | 0.7-c1 to c5: work on hot files, in the order below | **Yes** |

**The 0.7 order.** A task starts when everything before its arrow is merged; tasks on one line run side by side.

```text
Ready now:  x1 + x2 (together) · x3 · x4
x1 ─────────────→ p1
x2 ─────────────→ p3
x3 ─────────────→ p2
x4 ─────────────→ l1
x1 + x2 ────────→ c1
c1 ─────────────→ c2
p2 ─────────────→ a1 · a2 · a3
p2 ─────────────→ c5                    (not at the same time as c3: both change handler.ts)
c2 + p1 + p3 ───→ c3
c3 ─────────────→ c4
c4 ─────────────→ e1
l1 + c4 ────────→ l2
c4 + c5 + a3 + l2 → d1
everything ─────→ z1
```

The critical path is x1/x2 → c1 → c2 → c3 → c4 → l2 → d1 → z1, through Core. Admin (x3 → p2 → a1 · a2 · a3 · c5) and the loader (x4 → l1) run beside it. At the widest point, six lanes work at once: Hygiene, Decisions, Spikes, Ports, Add-ons and Core.

**Branches.** 0.6.x patches land on `main` with `--no-ff` and ship as they are ready. Every 0.7 task targets the integration branch `release/0.7` until the release ([RELEASING.md](RELEASING.md)). The maintainer creates `release/0.7` from `main` before the first 0.7 pull request; `main` already has the 0.6.x patches that change `server/handler.ts`.
