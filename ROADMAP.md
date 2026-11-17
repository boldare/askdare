# Roadmap

Where askdare is going, release by release. This file holds the direction only:
- **Decisions** that are expensive to reverse are [Architecture Decision Records](docs/adr/README.md).
- **Tasks and their status** live in the [GitHub Project](https://github.com/orgs/boldare/projects/20).

A change to what a release contains comes as a pull request to this file.

## 0.2.0: the chat inside your page

0.2.0 brought:
- the headless React API and the inline chat ([ADR-0011](docs/adr/0011-react-api-and-inline-chat.md));
- `add ui`;
- answer ratings, `onUsage` and the OpenTelemetry add-on ([ADR-0012](docs/adr/0012-server-hooks-and-telemetry.md));
- browser events ([ADR-0013](docs/adr/0013-browser-events.md)).

## 0.3.0: talk in more ways

0.3.0 is on npm as `latest`. What it brought:
- one-click deploy buttons for Vercel and Heroku, with the `/deploy` page on the website;
- reply options, suggested by the model or defined by a tool, the first slice of `toolRenderers` ([ADR-0015](docs/adr/0015-reply-options.md));
- runtime language, step 1: the page switches the chat's language and the iframe reloads, keeping the conversation ([ADR-0014](docs/adr/0014-runtime-language.md)).

Compaction left 0.3 after spike S5b; see Later.

## 0.4: settle in

0.4 ships these three, in this order, one at a time in the Core lane:

| Epic | Goal | Decision |
|---|---|---|
| Runtime language, step 2 | Switch the language in place, with texts per language in `defineBot` and `GET <basePath>/config/<bot>?lang=` | [ADR-0014](docs/adr/0014-runtime-language.md) |
| `toolRenderers` | React components for tool results, building on the reply-options payload. A design note comes first. | [ADR-0008](docs/adr/0008-ui-customization-and-themes.md), [ADR-0015](docs/adr/0015-reply-options.md) |
| `embedPath` | A custom UI inside the iframe, so the script-tag widget can use your own components and `toolRenderers`. A design note comes first. | [ADR-0005](docs/adr/0005-embedding-model.md), [ADR-0008](docs/adr/0008-ui-customization-and-themes.md) |

The design notes for `toolRenderers` and `embedPath` are written in the Decisions lane while the language work runs. Admin left 0.4 to keep it small; see Later.

## Later

The order of these is decided on the Project board:
- **Admin, stage 1.** A dev console with no database: bot configuration, `doctor`, a playground, test questions (ADR-0016).
- **Admin, stage 2.** The `@boldare/askdare-admin` add-on: a store port with Postgres and Upstash adapters, dashboards of costs and ratings, and review of 👎 conversations (ADR-0016).
- **Handoff to a human.** A `handoff` tool and an `onHandoff` hook (email, Slack, webhook).
- **Forms in the chat.** Collecting leads into `onLead`, with validated fields.
- **Remote MCP tools and an `httpTool` preset.** Connect existing systems without code.
- **Compaction, opt-in.** Spike S5b showed that a 50k threshold never shrinks the input: OpenAI keeps the latest ~60k tokens word for word, so compaction runs on every turn, loses prompt caching (12–24× the cost) and drops `file_search` citations. It needs a threshold of 100k or more, output headroom in the budgets and working citations first ([ADR-0003](docs/adr/0003-conversation-state.md)).
- **`askdare eval`.** Regression tests for answers, run in CI.
- **Smaller additions:** a proactive greeting, an unread badge, business hours, copying and exporting a conversation, prompt variants with A/B tests. The greeting and the badge live in the loader, which is at 4,963 of its 5,120 bytes (gzipped) after 0.3. Neither fits until the loader gets smaller or more of it moves into the iframe.
- **Languages:** more built-in languages, and right-to-left layouts.
- **Deferred in ADRs:** Turnstile ([ADR-0004](docs/adr/0004-threat-model.md)), and a `CustomEvent` for GTM ([ADR-0013](docs/adr/0013-browser-events.md)).

## How we track work

- **Issues are for current work only.** Epics and the tasks of the next two releases are issues of type **Task**, so they never read as bug reports. Anything further out, ideas included, is a draft item on the Project board. A draft becomes an issue when it moves to Ready.
- **Each task is an issue** made from the [agent-ready task template](.github/ISSUE_TEMPLATE/task.yml). Its fields are:
  - the goal;
  - the ADRs to read;
  - the files it may touch and those it must not;
  - the Definition of Done;
  - the tasks it depends on.
- **The issue is the whole brief** for whoever picks it up, person or agent.
- **The GitHub Project [askdare roadmap](https://github.com/orgs/boldare/projects/20)** holds every task, each a sub-issue of its epic. Its fields:
  - `Status`;
  - `Release`;
  - `Track`;
  - `Size`;
  - `Lane`;
  - `Hot files`.
- **Its views:**
  - a board by status;
  - a roadmap by release;
  - "Ready for agents", which lists unblocked tasks.

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
| Organization | The roadmap, the Project and the issues | No |
| Deploy | What is left of the deploy buttons: the starter template repo for the Heroku button | No |
| Decisions | ADRs and design notes, in parallel with everything. For 0.4: the `toolRenderers` and `embedPath` design notes | No |
| Spikes | Experiments in `spikes/` | No |
| Core | Runtime language step 2 (texts per language, then the `/config/<bot>` endpoint, then switching in place), then `toolRenderers`, then `embedPath` | **Yes**, one task at a time |

Core work for 0.4 lands on `main` with `--no-ff`, or on an integration branch `release/0.4` if a task must not reach `main` before the release ([RELEASING.md](RELEASING.md)).
