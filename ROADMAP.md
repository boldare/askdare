# Roadmap

Where askdare is going, release by release. This file holds the direction only:
- **Decisions** that are expensive to reverse are [Architecture Decision Records](docs/adr/README.md).
- **Tasks and their status** live in the [GitHub Project](#how-we-track-work).

A change to what a release contains comes as a pull request to this file.

## 0.2.0: the chat inside your page

0.2.0-rc is on npm. What's left before the stable release:

| Epic | Goal | Status |
|---|---|---|
| Release gates | `e2e:browsers`, `test:visual` and `verify:packs` with eject in a fresh app | Not started |
| Site demo | An inline React chat on the website that shows its [events](docs/events.md) live | Not started |
| README poster | The 0.2 features in the README images | Not started |
| Release | `changeset pre exit`, 0.2.0 as `latest` ([RELEASING.md](RELEASING.md)) | After the three above |

Shipped in 0.2:
- the headless React API and the inline chat ([ADR-0011](docs/adr/0011-react-api-and-inline-chat.md));
- `add ui`;
- answer ratings, `onUsage` and the OpenTelemetry add-on ([ADR-0012](docs/adr/0012-server-hooks-and-telemetry.md));
- browser events ([ADR-0013](docs/adr/0013-browser-events.md)).

## 0.3: talk in more ways

| Epic | Goal | Decision |
|---|---|---|
| Deploy buttons | One click from the starter to a running chat on Vercel or Heroku | Docs only |
| Reply options | Clickable answers under the latest reply. The model can suggest them, or a tool can define them. They're the first slice of `toolRenderers`. | ADR-0015 |
| Runtime language, step 1 | The page switches the chat's language (`askdare('configure', { locale })`, or following `<html lang>`). The iframe reloads, and the conversation stays. | ADR-0014 |
| Compaction | Cheaper long conversations, after spike S5b | [ADR-0003](docs/adr/0003-conversation-state.md) |
| `embedPath`, `toolRenderers` | A custom UI inside the iframe, and React components for tool results | [ADR-0008](docs/adr/0008-ui-customization-and-themes.md) |

## 0.4: settle in

| Epic | Goal | Decision |
|---|---|---|
| Runtime language, step 2 | Switch the language in place, with texts per language in `defineBot` | ADR-0014 |
| Admin, stage 1 | A dev console with no database: bot configuration, `doctor`, a playground, test questions | ADR-0016 |

## Later

The order of these is decided on the Project board:
- **Admin, stage 2.** The `@boldare/askdare-admin` add-on: a store port with Postgres and Upstash adapters, dashboards of costs and ratings, and review of 👎 conversations (ADR-0016).
- **Handoff to a human.** A `handoff` tool and an `onHandoff` hook (email, Slack, webhook).
- **Forms in the chat.** Collecting leads into `onLead`, with validated fields.
- **Remote MCP tools and an `httpTool` preset.** Connect existing systems without code.
- **`askdare eval`.** Regression tests for answers, run in CI.
- **Smaller additions:** a proactive greeting, an unread badge, business hours, copying and exporting a conversation, prompt variants with A/B tests.
- **Languages:** more built-in languages, and right-to-left layouts.
- **Deferred in ADRs:** Turnstile ([ADR-0004](docs/adr/0004-threat-model.md)), and a `CustomEvent` for GTM ([ADR-0013](docs/adr/0013-browser-events.md)).

## How we track work

- **Each task is an issue** made from the [agent-ready task template](.github/ISSUE_TEMPLATE/task.yml). Its fields are:
  - the goal;
  - the ADRs to read;
  - the files it may touch and those it must not;
  - the Definition of Done;
  - the tasks it depends on.
- **The issue is the whole brief** for whoever picks it up, person or agent.
- **The GitHub Project "askdare roadmap"** holds every task. Its fields:
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
| Release | The 0.2.0 site demo and poster run side by side, then the gates, then the release | No |
| Deploy | The deploy buttons | No |
| Decisions | ADRs, in parallel with everything | No |
| Spikes | Experiments in `spikes/` | No |
| Core | The reply-options foundation, then suggested and tool-defined options (in parallel), then runtime language step 1, then compaction | **Yes**, one task at a time |

Until 0.2.0 is out, core work for 0.3 lands on the integration branch `release/0.3`, which has a draft PR into `main`.
