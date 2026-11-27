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

What the 0.6 review left open and fit in a patch, from "Known gaps" below, done in parallel before the 0.7 tasks and merged into `main`: h1, resume after sign-in (#192); h2, no rating for a replaced answer (#196); h3, `doctor`'s store timeout (#193); h4, an index for the Postgres compaction lookup (#190); h5, regional endpoints documented (#194); h6, the chat-client half of h1: the live stream no longer hands back an anonymous resume token after sign-in (#201). They ship as 0.6.1 (the "Version packages" pull request #191 on `main`) or, if that hasn't merged by then, inside 0.7.0; `release/0.7` holds them either way, and [`0.7-y1`](tasks/0.7-y1-release.md) says how their changesets combine with 0.7's. One piece stays open in "Known gaps": a contract run against the EU endpoint, which needs a key from an EU-residency project.

## Ready to release: 0.7.0, support-grade

Built on `release/0.7` between 2026-11-26 and 2026-11-27 (tasks x1 to x4, p1 to p3, a1 to a3, b1, l1, l2, c1 to c5, d1, e1 and z1), with ADR-0030 to ADR-0033 accepted as built; [`0.7-y1`](tasks/0.7-y1-release.md) releases it. The features buyers compare against Intercom Fin and Chatbase:
- **Handoff to a human** (ADR-0030): a `handoff` tool and a "Talk to a person" button, a "connecting you" state in the chat, and an `onHandoff` hook with `webhookHandoff` and `emailHandoff`. One-way: a person answers by email.
- **Forms in the chat** (ADR-0031): `defineForm` and leads into `onLead`, with fields defined and validated on the server and drawn by the widget without the site's code. A handoff with nobody available falls back to its form.
- **Admin** (ADR-0016, extended by ADR-0032): the console at `<basePath>/admin` (configuration, `doctor`, the playground, conversation reviews), an `AdminStore` port with memory, Postgres and Upstash stores, and the dashboard add-on `@boldare/askdare-admin`: cost per bot, day and model, ratings, unanswered questions, leads, handoffs and resolution rate. Deleting a conversation, by the visitor or `sweep()`, deletes its admin records too.
- **A greeting next to the launcher and an unread badge** (ADR-0033), in a loader made smaller first: 5,284 of its new 5,632-byte budget, with the launcher now shown on pages that enforce Trusted Types.
- **The 0.6.x patches** above, unless 0.6.1 ships them first.

**Decided not to do in 0.7,** and where each piece went (ADR-0030 to ADR-0033, settled with the maintainer on 2026-11-26): live agent chat and stopping the bot after a handoff (0.9); a form that triggers an answer, finer admin metrics and the greeting following a language switch (0.8); lead values in the admin store (0.9, only if ADR-0031 is revisited); provider email adapters, prefilled form fields and bot-defined handoff reasons (Later). Testing the greeting in Firefox, WebKit, a screen reader and with reduced motion, and checking it never covers a focused control, stay in 0.7 (l2 and e1).

## 0.8: quality and reach

- **`askdare eval`:** regression tests for answers and citations, run in CI. 👎 conversations from admin become test cases. OpenAI's own Evals go read-only on 2026-11-30. It starts from spike S8's questions and grading (`spikes/s8-retrieval/`), plus a harder set: 100 or more documents, questions across languages, multi-turn follow-ups and PDFs. S8's set showed parity between `file_search` and our own retrieval, not a margin.
- **Prompt versions and A/B tests** in `defineBot`.
- **More tools:** remote MCP tools, an `httpTool` preset, `web_search` as a fallback when `file_search` finds nothing, and approving a tool call in the chat.
- **Model settings:** reasoning effort and verbosity, passed through and checked per model, with no model IDs in the library.
- **Attachments in your own storage:** a file store port with an S3-compatible add-on, so attachments are sent inline and kept in your own bucket instead of OpenAI Files, closing the last "kept at OpenAI" exception (see Known gaps).
- **Follow-ups from 0.7:**
  - **size headroom, a risk:** after 0.7 the React entry has 538 bytes left of its 34 KB and the headless case (`Root` and `useChat`) 86 of its 12 KB (gzipped, on `release/0.7` in CI; 501 and 86 with a local Node's zlib). A 0.8 feature that reaches the chat, such as approving a tool call, makes room first (ADR-0028, decision 3) or comes with an ADR that raises a budget;
  - the console's test questions per bot (ADR-0016), which ADR-0032 left without a configuration surface; they fit `askdare eval`'s test cases;
  - a form whose submission runs a model turn, as an opt-in per form (ADR-0031 left it out of 0.7);
  - admin metrics per conversation: handoff facts per conversation, so the resolution rate isn't a daily ratio; a better "unanswered questions" signal than the citation heuristic, such as a flag for searches that found nothing; more dashboard queries, each with its Upstash backfill (ADR-0032). They feed `askdare eval`;
  - the greeting's text follows a language switch while it is shown, if someone asks for it (ADR-0033).

## 0.9: open

- **A second provider path** ([ADR-0026](docs/adr/0026-provider-path.md)): OpenRouter as a stateless provider profile of the existing OpenAI gateway, on 0.6's own store and retrieval. A profile carries its capabilities, the request fields its provider needs (such as `cache_control` for prompt caching), the forced-last-step note and an error classifier. Support covers verified models only, listed in the docs: Claude Haiku 5.5 passed spike S6b, `gpt-oss-120b` did not.
- **Verify Hugging Face and local servers** for a profile each: rerun the S6b probes in `spikes/s6b-open-responses/` with a funded Hugging Face account (about 5 USD) and, for Ollama or another local server, on a machine that can run a model with tools. What to look at: errors that arrive as HTTP 200 with `response.failed`, and Hugging Face refusing `allowed_tools`. S6b couldn't run either (402 without credits; the 16 GB laptop froze), so they are not verified, not rejected.
- **Native adapters** (Claude first, as `@boldare/askdare-anthropic`) stay an option for when a client needs them, under ADR-0026's conditions: a public `ModelGateway` port, reply options before the answer, and no voice or moderation.
- **Interop:** expose the chat stream to AI SDK UI messages or AG-UI, so those ecosystems can use askdare's backend.
- **Handoff adapters and live chat:** Slack, HubSpot and Zendesk. With a person writing in the chat, a setting stops the bot after a handoff (ADR-0030), and a person's reply reaches the widget as `message.received`, so the unread badge counts it (ADR-0033).
- **Handoff and lead records in the admin store,** beyond counts, only if ADR-0031's "askdare stores no form values" is revisited for these adapters (ADR-0032).

## 1.0: stable

API freeze, a support policy and a migration guide from 0.x. We cut 1.0 once two or three teams have run 0.7 or later in production and two minors have shipped without breaking the API.

## Known gaps

What 0.6 and 0.7 leave open, found by their tasks and reviews. Each line names where it goes; a release that takes one moves it into its own section. 0.7 closed two: transcripts kept in the admin store are deleted with their conversation (an app's own `onTranscript` copies stay the app's to delete, and the docs point to `admin.transcripts`), and `sweep()` on the handlers is the sweep helper in core, so a cron route no longer imports `openai`.

**Data that still reaches or stays at OpenAI** ([own your data](docs/own-your-data.md#what-stays-at-openai)):
- **Attachments** are stored in OpenAI Files until they expire (30 days) or the conversation is deleted, and Files isn't eligible for Zero Data Retention. This is the one exception to "nothing kept at OpenAI" with your own store and ZDR. Next step: a file store port with an S3-compatible add-on, so attachments are sent inline and kept in your own bucket. 0.8.
- **Regional endpoints: no live run yet.** `OPENAI_BASE_URL` points every askdare client at a regional endpoint, and [Deployment](docs/deployment.md#regional-openai-endpoints) says what OpenAI's EU endpoint covers (everything askdare calls except the default Conversations API). Probed on 2026-11-26 with a Global project's key: the EU host routes, but answers 401 on responses and conversations without a residency project. The full contract and smoke run still waits for a key from an EU-residency project, which needs OpenAI's sales team ([Live testing](docs/live-testing.md#against-a-regional-endpoint)). A 0.7.x patch, as soon as a key is available.
- **No model request without OpenAI** until another provider path exists. 0.9 ([ADR-0026](docs/adr/0026-provider-path.md)).

**Release and CI:**
- **The Upstash admin store has passed its contract only against a local Redis** behind the Upstash REST proxy, never against Upstash itself, as the turn log in 0.6. 0.7, in task y1 before the release; if it can't run, a 0.7.x patch.
- **The REST proxy's CI image is pinned by tag** (`hiett/serverless-redis-http:0.0.10`, in `.github/workflows/ci.yml` and `packages/askdare-upstash/docker-compose.yml`), not by digest, so a re-pushed tag changes what the Upstash tests run against. 0.7.x, a hygiene patch.
- **Auto-merge is off in the repository.** A note for the maintainer, not a task: pull requests are merged by hand until the maintainer changes the setting.

**Smaller items:**
- A message sent at the moment a compaction is stored gets a "please wait" error (documented in [ADR-0029](docs/adr/0029-compaction-for-item-stores.md)). Later.
- A note that `POST /handoff` or `POST /forms` appends while a turn on an item store is still running can make that turn's next append conflict, and the visitor sees "conversation busy" (ADR-0030, "As built"). 0.8.
- No browser event when a handoff is requested or a form is sent: the headless budget had no room for the 78 bytes. Later, if analytics asks for them.
- The console's playground doesn't show a turn's usage, which reaches `onUsage` only after the stream closes. Later.

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
- a `CustomEvent` for GTM ([ADR-0013](docs/adr/0013-browser-events.md));
- from the 0.7 decisions, each only when someone asks: ready-made email adapters (Resend, Postmark) as small add-ons ([ADR-0030](docs/adr/0030-handoff.md)); handoff reasons a bot defines itself (ADR-0030); form fields the model fills in, which first needs an ADR on prompt injection ([ADR-0031](docs/adr/0031-forms-and-leads.md)); a `POST <basePath>/sweep` route for cron services ([ADR-0032](docs/adr/0032-admin-store.md)); a greeting shown once per session even when the visitor ignores it, which would need storage before the visitor acts ([ADR-0033](docs/adr/0033-greeting-and-loader-budget.md)).

Considered and not planned: price tables in the core (the app passes prices, ADR-0032); loading the greeting as a second script (ADR-0033's fallback, only if the 5.5 KB budget must shrink again); shorter console warnings in the loader (only if the budget gets tight).

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
- `embed/loader.ts`, which has a 5.5 KB budget (ADR-0033);
- `i18n/locales/*`, changed together with `i18n/texts.ts`;
- `server/handler.ts`, which every 0.7 feature mounts into.

Two shared files don't make a task hot:
- **The API snapshot** (`api/askdare.api.txt`) is generated. A task that changes the public API rebases and regenerates it (`pnpm --filter @boldare/askdare api:update`) instead of merging it by hand.
- **ADR-0006** is updated once per release, by its z1 task, from the public surface the release's ADRs list. Other tasks don't edit it.

New ADRs written at the same time take numbers reserved in their task files (0030 to 0033 for 0.7), so parallel pull requests don't collide.

| Lane | What runs in it | Hot files |
|---|---|---|
| Organization | The roadmap and `tasks/` | No |
| Hygiene | Patches on `main` | No |
| CI | Workflows, visual baselines, the starter check, the site's end-to-end tests | No |
| Decisions | A release's ADRs, accepted or amended by the tasks that build them, and its z1 and y1 | No |
| Docs | A release's guides | No |
| Ports | New modules inside `packages/askdare` that no hot file reaches yet | No |
| Add-ons | `packages/askdare-*` | No |
| Loader | `embed/loader.ts`, which no other task changes | Its own |
| Core | Work on hot files, in the order a release sets | **Yes** |

Every 0.7 task is merged into `release/0.7`; 0.8's lanes and order come with its tasks, once it is planned.

**Branches.** Patches land on `main` with `--no-ff` and ship as they are ready. Every 0.7 task targeted the integration branch `release/0.7` ([RELEASING.md](RELEASING.md)), created from `main` on 2026-11-26 and holding every 0.6.x patch; task y1 merges it into `main`.
