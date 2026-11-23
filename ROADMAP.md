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

The foundation that admin, handoff, data residency and other providers all need: conversations stored outside OpenAI.
- A `ConversationStore` port with OpenAI Conversations as the default and a Postgres add-on (`@boldare/askdare-postgres`), plus an `onTranscript` hook. This opens zero-data-retention and EU-resident setups.
- A retrieval port: OpenAI vector stores by default, pgvector as an option.
- Both are split out of the existing `ModelGateway` (`src/gateway.ts`), so a second provider would only have to run turns.
- Stream resume after a dropped connection, and history beyond the latest 100 items.
- Compaction, decided again in a new ADR now that we can own the stored history (spikes S5 and S5b ruled out OpenAI's server-side compaction as a default).

Four spikes run in parallel before this release is planned: S6a (Claude behind the gateway), S6b (Open Responses endpoints), S7 (conversations stored outside OpenAI) and S8 (retrieval outside OpenAI vector stores). Task P1 then writes the ADRs and the 0.6 task files from their findings.

## 0.7: support-grade

The features buyers compare against Intercom Fin and Chatbase.
- **Handoff to a human:** a `handoff` tool, a "connecting you" state in the chat, and an `onHandoff` hook. Email and webhook first.
- **Forms in the chat:** leads into `onLead`, with validated fields, built on reply options and tool cards.
- **Admin** (ADR-0016): stage 1, the console with no database, then stage 2, `@boldare/askdare-admin` on the 0.6 store, with transcripts, ratings, unanswered questions, cost per conversation and resolution rate.
- **Proactive greeting and an unread badge.** The loader is at 5,016 of its 5,120 bytes (gzipped), so this starts by making it smaller or moving logic into the iframe.

## 0.8: quality and reach

- **`askdare eval`:** regression tests for answers and citations, run in CI. 👎 conversations from admin become test cases. OpenAI's own Evals go read-only on 2026-11-30.
- **Prompt versions and A/B tests** in `defineBot`.
- **More tools:** remote MCP tools, an `httpTool` preset, `web_search` as a fallback when `file_search` finds nothing, and approving a tool call in the chat.
- **Model settings:** reasoning effort and verbosity, passed through and checked per model, with no model IDs in the library.

## 0.9: open

- **A second provider path:** an Open Responses adapter behind the gateway, decided in an ADR after a spike against two or three endpoints. Full multi-provider support (native Anthropic, Google or Mistral adapters) stays an option for when a client needs it.
- **Interop:** expose the chat stream to AI SDK UI messages or AG-UI, so those ecosystems can use askdare's backend.
- **Handoff adapters:** Slack, HubSpot and Zendesk.

## 1.0: stable

API freeze, a support policy and a migration guide from 0.x. We cut 1.0 once two or three teams have run 0.7 or later in production and two minors have shipped without breaking the API.

## Later

Ordered when a release is planned:
- other channels (Slack, Teams, WhatsApp) through a chat SDK;
- voice conversations;
- native adapters for other model providers;
- right-to-left layouts;
- business hours, copying and exporting a conversation;
- a `CustomEvent` for GTM ([ADR-0013](docs/adr/0013-browser-events.md)).

## How we track work

- **Tasks live in the repository,** in [`tasks/`](tasks/README.md): one file per task, with its status, lane and dependencies. Only the next release gets task files; anything further out is a section or a line above.
- **The task file is the whole brief** for whoever picks it up, person or agent: the goal, the ADRs to read, the files it may touch and those it must not, the Definition of Done and the tasks it depends on.
- **The pull request that finishes a task deletes its file,** so `tasks/` lists only open work.
- **GitHub issues are for users:** bug reports and feature requests. Roadmap work doesn't go there.

### Lanes and hot files

Work runs in parallel lanes. Tasks that touch the **hot files** run one at a time, because those files meet in every feature:
- `protocol/*` and `docs/protocol.md`;
- `chat/state.ts`, `chat/reducer.ts`, `chat/store.ts` and `chat/events.ts`;
- `bot/define-bot.ts`;
- `i18n/texts.ts`;
- `react/headless.ts`;
- `embed/loader.ts`, which has a 5 KB budget;
- the API snapshot (`api/askdare.api.txt`) and ADR-0006.

| Lane | What runs in it | Hot files |
|---|---|---|
| Organization | The roadmap and `tasks/` | No |
| Hygiene | 0.5.x patches | No |
| CI | Workflows, visual baselines, the starter check | No |
| Decisions | ADRs, as decisions come up (0019 to 0023 accepted for 0.5) | No |
| Docs | Guides for new features, the compliance guide, the accessibility statement | No |
| Spikes | S6a, S6b, S7 and S8, side by side; each writes only its own `spikes/` folder | No |
| Core | 0.6 work that touches hot files, one task at a time | **Yes** |

Patches for 0.5.x land on `main` with `--no-ff` and ship as they are ready. Breaking 0.6 work goes to an integration branch `release/0.6` until the release ([RELEASING.md](RELEASING.md)).
