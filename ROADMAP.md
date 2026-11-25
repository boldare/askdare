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

## 0.6: own your data

The foundation that admin, handoff, data residency and other providers all need: conversations and knowledge stored outside OpenAI. Spikes S6a, S6b, S7 and S8 ran first; their findings are in [ADR-0024](docs/adr/0024-conversation-store.md) to [ADR-0027](docs/adr/0027-stream-resume.md), accepted with the work that built them; [ADR-0006](docs/adr/0006-support-matrix-and-versioning.md) lists the public surface.
- **A `ConversationStore` port** (ADR-0024): OpenAI Conversations stays the default, with no database; `memoryConversations()` for tests; a Postgres add-on, `@boldare/askdare-postgres`. With a store of your own, turns replay the history with `store: false`, so nothing stays at OpenAI: zero-data-retention and EU-resident setups work. Ownership is checked against the store, old conversations can be swept, and the `onTranscript` hook (ADR-0016) lands too.
- **A retrieval port** (ADR-0025): OpenAI vector stores stay the default; pgvector in the same add-on, behind a `search_knowledge` tool that works on every model path, with citations on today's protocol. `askdare kb sync` syncs the same folder to either. Markdown, MDX, text and HTML on the own path; PDFs later.
- **Both are split out of `ModelGateway`** (ADR-0026), so a second provider (0.9) only has to run turns. No new provider in 0.6.
- **History beyond the latest 100 items,** paged by turn.
- **Resuming an answer after a dropped connection** (ADR-0027): a separate `TurnEventLog` port, in memory by default and on Upstash for sites with several instances.
- **Compaction for conversations in your own store** ([ADR-0029](docs/adr/0029-compaction-for-item-stores.md)): opt-in `limits.compactAt`. Once a turn gets that large, askdare compacts the conversation in the background, so the following turns replay a few thousand tokens. Spike S9 measured 27–56 % lower cost over a 50-turn conversation, with facts and citations kept. The OpenAI Conversations default gets no compaction.

## 0.7: support-grade

The features buyers compare against Intercom Fin and Chatbase.
- **Handoff to a human:** a `handoff` tool, a "connecting you" state in the chat, and an `onHandoff` hook. Email and webhook first.
- **Forms in the chat:** leads into `onLead`, with validated fields, built on reply options and tool cards.
- **Admin** (ADR-0016): stage 1, the console with no database, then stage 2, `@boldare/askdare-admin` on the 0.6 store, with transcripts, ratings, unanswered questions, cost per conversation and resolution rate. Deleting a conversation, by the visitor or a sweep, then deletes its transcripts and ratings too; 0.6 calls no hook on delete.
- **Proactive greeting and an unread badge.** The loader is at 5,016 of its 5,120 bytes (gzipped), so this starts by making it smaller or moving logic into the iframe.

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
- **for 0.6, the seams of the gateway split:** `gateway.ts`, `openai/turn.ts`, `openai/history.ts`, `server/handler.ts` and `server/stream-turn.ts`.

Two shared files don't make a task hot in 0.6:
- **The API snapshot** (`api/askdare.api.txt`) is generated. A task that changes the public API rebases and regenerates it (`pnpm --filter @boldare/askdare api:update`) instead of merging it by hand.
- **ADR-0006** is updated once, by task 0.6-z1, from the public surface that ADR-0024 to ADR-0027 list. Other 0.6 tasks don't edit it.

| Lane | What runs in it | Hot files |
|---|---|---|
| Organization | The roadmap and `tasks/` | No |
| Hygiene | 0.5.x patches; 0.6-h1 | No |
| CI | Workflows, visual baselines, the starter check; 0.6-c1 | No |
| Decisions | ADRs 0024 to 0027 and 0029, accepted or amended by the tasks that build them; 0.6-z1 | No |
| Docs | Guides for new features; 0.6-d1 | No |
| Ports | New modules inside `packages/askdare` that no hot file reaches yet: 0.6-k1, 0.6-k3, 0.6-r1 | No |
| Add-ons | `packages/askdare-postgres` (0.6-a1, a2, a3) and `packages/askdare-upstash` (0.6-r2); one folder per task inside a package | No |
| Core | 0.6-1, 2, k2, t1, 3a, 4, 3b, r3a, r3b: work on hot files, in the order below | **Yes** |

**The 0.6 order.** A task starts when everything before its arrow is merged; tasks on one line run side by side.

```text
Ready now:  1 · k1 · r1 · a1 · h1 · c1
1 ─────────────→ 2 · a2 (a2 also needs a1)
k1 ────────────→ a3 (needs a1) · k3
r1 ────────────→ r2
2 + k1 + h1 ───→ k2 · t1 (t1 needs only 2)
k2 + t1 ───────→ 3a · 4
3a ────────────→ 3b · r3a (r3a also needs r1 and 4)
3b + r3a ──────→ r3b
a2 + a3 + k2 + k3 → d1
everything ────→ z1
```

The critical path is 1 → 2 → k2 → 3a → 3b or r3a → r3b → z1, all in Core. Everything else runs beside it.

**Branches.** 0.5.x patches land on `main` with `--no-ff` and ship as they are ready; so do 0.6-h1 and 0.6-c1. Every other 0.6 task targets the integration branch `release/0.6` until the release ([RELEASING.md](RELEASING.md)). The maintainer creates `release/0.6` from `main` before the first 0.6 pull request.
