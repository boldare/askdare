# @boldare/askdare

[![askdare: an AI assistant for any website, in one script tag. A chat panel answers a question about a pricing plan with a list, a table and two cited sources.](https://raw.githubusercontent.com/boldare/askdare/main/.github/assets/askdare-hero.png)](https://askdare.vercel.app)

**[Website and live demo](https://askdare.vercel.app)** · **[Documentation](https://askdare.vercel.app/docs)** · [GitHub](https://github.com/boldare/askdare) · [Changelog](https://github.com/boldare/askdare/blob/main/packages/askdare/CHANGELOG.md)

**Dare to ask.** An AI chatbot for any website, served by your Next.js app and built on the official OpenAI SDK. One route file, one `<script>` tag, no database.

- Embeds anywhere through a small loader and an isolated iframe, limited to the sites you list.
- Secure by default: short-lived session tokens, rate limits, daily token budgets, sanitized output.
- Knowledge base with citations, your own tools, image and PDF attachments, voice input.
- Four themes in light and dark, English and Polish texts, customizable down to your own CSS.

> **Release candidate (0.1.0-rc).** The API may still change before 0.1.0; pin the exact version.

## Quick start

In a Next.js 16 app with the App Router:

```bash
npm install @boldare/askdare@rc zod
npx @boldare/askdare init      # route, bot config, .env.local and the chat script
# set OPENAI_API_KEY and ASKDARE_MODEL in .env.local
npm run dev
npx @boldare/askdare doctor    # checks the key, model, permissions and headers
```

`init` writes the bot definition and the route, and loads the chat in the root layout:

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

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;
export const { GET, POST, DELETE } = createChatHandler({ bots });
```

Other sites embed the same chat with one tag:

```html
<script src="https://your-app.example.com/api/chat/widget.js?bot=support" async></script>
```

## Documentation

The guides ship with the package in `node_modules/@boldare/askdare/docs/`, starting with `getting-started.md`; `configuration.md`, `cli.md` and `troubleshooting.md` are the references. They are also on the [website](https://askdare.vercel.app/docs), with search, and on [GitHub](https://github.com/boldare/askdare/tree/main/docs). AI coding agents can start from `node_modules/@boldare/askdare/llms.txt`, or use the skill in `node_modules/@boldare/askdare/skills/askdare/` (copy the folder into `.claude/skills/`).

## Requirements

Node.js 22 or later, Next.js 16 with the App Router on the Node.js runtime, React 19 and zod 4.1 or later. The full matrix, browsers included, is in `docs/support.md`.

## License

MIT © Boldare
