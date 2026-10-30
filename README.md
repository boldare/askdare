# askdare

**Dare to ask.** An AI assistant for any website, in one script tag.

> **Status: pre-alpha, under active development. Not published yet.**

`@boldare/askdare` is a Next.js library for adding an AI chatbot, built on the official OpenAI SDK, to any website. It takes one route file and one `<script>` tag.

It succeeds [`@boldare/openai-assistant`](https://github.com/boldare/openai-assistant), which stopped working when OpenAI shut down the Assistants API on 2026-08-26. askdare is a new, independent project built on the Responses API.

## What it does

- **Embed anywhere:** a tiny loader script plus an isolated iframe, with a per-site allowlist.
- **Secure by default:** short-lived session tokens, rate limits, daily spend budgets, sanitized output.
- **Knowledge base:** answers from your files via OpenAI file search, with citations linking to your pages.
- **Tools:** your own functions, defined with Zod schemas and validated end to end.
- **Attachments and images**, plus **voice input** (speech to text).
- **No database required:** conversations live in the OpenAI Conversations API.
- **Looks good out of the box:** four themes (Halo, Aura, Sage, Care) in light and dark, English and Polish texts, and everything customizable from configuration to your own CSS.

## Quick start

In a Next.js 16 app with the App Router:

```bash
npm install @boldare/askdare zod
npx @boldare/askdare init      # route, bot config, .env.local and the chat script
# set OPENAI_API_KEY and ASKDARE_MODEL in .env.local
npm run dev
npx @boldare/askdare doctor    # checks the key, model, permissions and headers
```

The whole integration is two files:

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;
export const { GET, POST, DELETE } = createChatHandler({ bots });
```

```html
<script src="https://your-app.example.com/api/chat/widget.js?bot=support" async></script>
```

[Getting started](docs/getting-started.md) walks through it step by step.

## Documentation

- [Getting started](docs/getting-started.md)
- [Knowledge base](docs/knowledge-base.md), [Tools](docs/tools.md), [Attachments](docs/attachments.md), [Voice input](docs/voice-input.md)
- [Styling](docs/styling.md) and [Themes](docs/themes.md)
- [Deployment](docs/deployment.md) to Vercel and Heroku, and the [going-public checklist](docs/going-public.md)
- [Support](docs/support.md): versions, browsers and download sizes
- [Threat model](THREAT_MODEL.md) and [streaming protocol](docs/protocol.md)

For AI coding agents: [`llms.txt`](llms.txt), and the [`askdare` skill](skills/askdare/SKILL.md). The docs also ship in the package, under `node_modules/@boldare/askdare/docs/`.

## Design decisions

The architecture is documented as [Architecture Decision Records](docs/adr/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Boldare
