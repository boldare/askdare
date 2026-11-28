[![askdare: an AI assistant for any website, in one script tag. A chat panel answers a question about a pricing plan with a list, a table and two cited sources.](.github/assets/askdare-hero.png)](https://askdare.vercel.app)

<p align="center">
  An AI chatbot for any website, served by your Next.js app on the official OpenAI SDK.<br>
  One route, one script tag, no database required.
</p>

<p align="center">
  <a href="https://askdare.vercel.app"><strong>Live demo</strong></a> ·
  <a href="https://askdare.vercel.app/deploy"><strong>Deploy in 5 minutes</strong></a> ·
  <a href="https://askdare.vercel.app/docs"><strong>Documentation</strong></a> ·
  <a href="https://www.npmjs.com/package/@boldare/askdare">npm</a> ·
  <a href="packages/askdare/CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/boldare/askdare/actions/workflows/ci.yml"><img src="https://github.com/boldare/askdare/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@boldare/askdare"><img src="https://img.shields.io/npm/v/@boldare/askdare" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

## Your chatbot in five minutes

**One-click deploy to Vercel.** Bring an OpenAI key, we'll do the rest.

No Next.js app yet? Deploy the [starter](examples/starter): your own repository, your OpenAI key, no database and no code to write. [askdare.vercel.app/deploy](https://askdare.vercel.app/deploy) walks you through it and makes the `CHAT_SECRET` for you. [Heroku and the details](docs/deployment.md#one-click-deploy).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fboldare%2Faskdare%2Ftree%2Fmain%2Fexamples%2Fstarter&project-name=askdare-chat&repository-name=askdare-chat&env=OPENAI_API_KEY%2CCHAT_SECRET%2CASKDARE_MODEL%2CASKDARE_INSTRUCTIONS%2CASKDARE_GREETING&envDefaults=%7B%22ASKDARE_MODEL%22%3A%22gpt-6.1-terra%22%2C%22ASKDARE_INSTRUCTIONS%22%3A%22You%20are%20the%20assistant%20on%20our%20website.%20Answer%20briefly%20and%20politely.%20If%20you%20do%20not%20know%20something%2C%20say%20so.%22%2C%22ASKDARE_GREETING%22%3A%22Hi%21%20How%20can%20I%20help%3F%22%7D&envDescription=OPENAI_API_KEY%3A%20a%20key%20from%20a%20dedicated%20OpenAI%20project%20with%20a%20hard%20spend%20limit.%20CHAT_SECRET%3A%20at%20least%2032%20random%20characters%3B%20askdare.vercel.app%2Fdeploy%20makes%20one%20for%20you.%20ASKDARE_MODEL%3A%20a%20current%20OpenAI%20model%20your%20project%20may%20use.%20ASKDARE_INSTRUCTIONS%3A%20what%20the%20bot%20does%20and%20how%20it%20answers.%20ASKDARE_GREETING%3A%20the%20first%20message%20in%20the%20chat.&envLink=https%3A%2F%2Faskdare.vercel.app%2Fdeploy)

[![The one-click deploy in 19 seconds: from askdare.vercel.app to the /deploy page, where the CHAT_SECRET is made, then Vercel deploys the starter, and the new app's chat answers a question.](.github/assets/deploy-flow.gif)](https://askdare.vercel.app/deploy)

## Three steps

[![How it works: install the package, run init, and paste one script tag on any website. The chat opens on the site from a launcher in the corner.](.github/assets/askdare-how-it-works.png)](https://askdare.vercel.app/docs/getting-started)

In a Next.js 16 app:

```bash
npm install @boldare/askdare zod
npx @boldare/askdare init
```

`init` writes the chat route, a bot to start from and `.env.local`, and adds the chat to your layout. Put your OpenAI key and model in `.env.local`, run the app, and the chat is there. The bot is a few lines you own:

```ts
// askdare.config.ts
import { defineBot } from '@boldare/askdare';

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: 'You answer questions about our product. If you do not know, say so.',
    security: { allowedOrigins: ['https://www.example.com'] },
    widget: { theme: 'aura', greeting: 'Hi! How can I help?' },
  }),
];
```

**[Getting started](docs/getting-started.md)** takes you from an empty app to a working chat in about 15 minutes.

Or [try it first, in five minutes](#your-chatbot-in-five-minutes), without your own app.

## What you get

[![What it does: answers from your documents with citations, your own tools, images and PDFs, voice input, secure by default, the chat inside your own page with React, thumbs-up and thumbs-down ratings of answers, observability with OpenTelemetry, and chat events for analytics. Also clickable answers suggested by the model, reply options from your tools, switching the chat's language from the page, a one-click deploy, tool cards drawn by your own React components, your own page inside the widget, and texts per language. New in 0.5: guardrails with OpenAI moderation and your own rules, a human check with Cloudflare Turnstile, seven built-in languages, and WCAG 2.2 AA. No database.](.github/assets/askdare-features.png)](https://askdare.vercel.app/#features)

[Knowledge base](docs/knowledge-base.md) · [Tools](docs/tools.md) · [Tool cards](docs/react.md#tool-cards) · [Reply options](docs/reply-options.md) · [Attachments](docs/attachments.md) · [Voice input](docs/voice-input.md) · [The chat inside your page (React)](docs/react.md) · [Your own page in the widget](docs/embedding.md#your-own-page-in-the-iframe) · [Answer ratings](docs/feedback.md) · [Handoff to a person](docs/handoff.md) · [Forms and leads](docs/forms.md) · [Admin console and dashboard](docs/admin.md) · [Launcher greeting](docs/embedding.md#a-greeting-and-an-unread-badge) · [Observability](docs/observability.md) · [Chat events](docs/events.md) · [Guardrails](docs/guardrails.md) · [Human check](docs/configuration.md#human-check) · [Accessibility](docs/accessibility.md) · [Own your data](docs/own-your-data.md) · [Security](THREAT_MODEL.md)

**New in 0.7, support-grade:**

- **Handoff to a person**: a "Talk to a person" button and a `handoff` tool the model calls when it can't help, with `webhookHandoff()` (signed with Standard Webhooks) or `emailHandoff()` delivering the request. It is one-way: a person from your team answers the visitor by email. Outside your office hours, the handoff's form takes a message instead. See [Handoff](docs/handoff.md).
- **Forms in the chat**: `defineForm` with text, email, phone, select, textarea and consent fields, validated on the server and drawn by the widget with no code on your site. Each sent form goes to your `onLead`, and its values reach the model only for the fields you mark. See [Forms](docs/forms.md).
- **Admin console and dashboard**: a console at `/api/chat/admin`, off by default, with each bot's configuration, `doctor`, a playground and conversation reviews, signed in with `ADMIN_SECRET` or an identity token. Records live in an admin store (memory, Postgres or Upstash), and the new [`@boldare/askdare-admin`](packages/askdare-admin) adds a dashboard: cost per bot, day and model, ratings, unanswered questions, leads and handoffs. Deleting a conversation deletes its records. See [Admin](docs/admin.md).
- **A greeting next to the launcher and an unread badge**: `widget.launcherGreeting` invites visitors after a few seconds, and answers that arrive while the chat is closed are counted on the launcher. See [Embedding](docs/embedding.md#a-greeting-and-an-unread-badge).

**New in 0.6, own your data:**

- **Conversations in your own Postgres**: `postgresConversations()` from the new [`@boldare/askdare-postgres`](packages/askdare-postgres), with `migrate` for the tables and a sweep for your retention. Turns go to OpenAI with `store: false`: it still processes every request, but keeps no conversation. See [Own your data](docs/own-your-data.md).
- **Knowledge in pgvector**: `pgvectorIndex` with `askdare kb sync --index`, searched by the built-in `search_knowledge` tool, with the same cited sources and no per-search fee. See [Knowledge base](docs/knowledge-base.md#your-own-index).
- **Answers that survive a dropped connection**: the chat picks an answer up where it stopped, from memory on one server or from Upstash on several (`upstashTurnLog()`). See [Configuration](docs/configuration.md#resume).
- **The whole history**: older messages load in pages as the visitor scrolls up (`LoadEarlier`). See [React](docs/react.md#long-conversations).
- **Compaction and transcripts**: opt-in `limits.compactAt` keeps long conversations in your store affordable, and `onTranscript` hands each finished turn to your code. See [Configuration](docs/configuration.md#compaction).
- **Still at OpenAI**: OpenAI processes every model request, and attachments stay in OpenAI Files. See [What stays at OpenAI](docs/own-your-data.md#what-stays-at-openai) and the [changelog](packages/askdare/CHANGELOG.md).


## Themes

[![Four themes, light and dark, or your own: the welcome screens of Halo, Aura in dark mode, Sage, Care, and BLDR, a custom theme in Boldare's style.](.github/assets/askdare-themes.png)](https://askdare.vercel.app/#themes)

Pick a theme, set your brand's colors, or restyle any part with your own CSS, the way BLDR does. Switch between them on the [website](https://askdare.vercel.app/#themes), then read [Themes](docs/themes.md) and [Styling](docs/styling.md).

## Documentation

The guides are on [askdare.vercel.app/docs](https://askdare.vercel.app/docs), with search and a chat that answers from them. The same pages are in [`docs/`](docs/), and they ship in the package, so they match the version you installed.

- **Start:** [Getting started](docs/getting-started.md) · [Embedding the chat](docs/embedding.md) · [Command line](docs/cli.md)
- **Features:** [Knowledge base](docs/knowledge-base.md) · [Tools](docs/tools.md) · [Tool cards](docs/react.md#tool-cards) · [Reply options](docs/reply-options.md) · [Attachments](docs/attachments.md) · [Voice input](docs/voice-input.md) · [Signed-in visitors](docs/identity.md) · [Handoff to a person](docs/handoff.md) · [Forms and leads](docs/forms.md)
- **Look and language:** [Themes](docs/themes.md) · [Styling](docs/styling.md) · [Texts](docs/texts.md) · [The chat inside your page (React)](docs/react.md)
- **Going live:** [Deployment](docs/deployment.md) · [Own your data](docs/own-your-data.md) · [Going-public checklist](docs/going-public.md) · [Guardrails](docs/guardrails.md) · [Costs](docs/costs.md) · [Observability](docs/observability.md) · [Chat events](docs/events.md) · [Answer ratings](docs/feedback.md) · [Admin console and dashboard](docs/admin.md) · [Privacy](docs/privacy.md) · [Compliance](docs/compliance.md) · [Accessibility](docs/accessibility.md)
- **Reference:** [Configuration](docs/configuration.md) · [Troubleshooting](docs/troubleshooting.md) · [Support matrix](docs/support.md) · [Wire protocol](docs/protocol.md) · [Custom stores](docs/custom-store.md)
- **Under the hood:** [Threat model](THREAT_MODEL.md) · [Design decisions](docs/adr/README.md)
- **AI coding agents:** [`llms.txt`](llms.txt) and the [`askdare` skill](skills/askdare/SKILL.md), both in the package ([how to use them](docs/getting-started.md#working-with-an-ai-coding-agent))

Coming from `@boldare/openai-assistant`? It stopped working when OpenAI shut down the Assistants API, and askdare is its successor: see [Migrating](docs/migrating-from-openai-assistant.md).

## Packages

| Package | What it is |
| --- | --- |
| [`@boldare/askdare`](packages/askdare) | The library: bots, the chat route, the embeddable chat and the CLI |
| [`@boldare/askdare-upstash`](packages/askdare-upstash) | Rate limits, budgets and answer resume shared by every server instance, and an admin store, in Upstash Redis |
| [`@boldare/askdare-otel`](packages/askdare-otel) | OpenTelemetry spans for every chat turn, following the GenAI conventions |
| [`@boldare/askdare-postgres`](packages/askdare-postgres) | Conversations, a pgvector knowledge index and an admin store in your own Postgres |
| [`@boldare/askdare-admin`](packages/askdare-admin) | The admin dashboard: cost, ratings, unanswered questions, leads, handoffs and conversation reviews, inside the admin console |

---

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [MIT license](LICENSE) · Made by [Boldare](https://www.boldare.com)
