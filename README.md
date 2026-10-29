# chatdock

> **Status: pre-alpha, under active development. Not published yet.**

`@boldare/chatdock` is a Next.js library for adding an AI chatbot, built on the official OpenAI SDK, to any website. It takes one route file and one `<script>` tag.

It succeeds [`@boldare/openai-assistant`](https://github.com/boldare/openai-assistant), which stopped working when OpenAI shut down the Assistants API on 2026-08-26. chatdock is a new, independent project built on the Responses API.

## What it will do (0.1)

- **Embed anywhere:** a tiny loader script plus an isolated iframe, with a per-site allowlist.
- **Secure by default:** short-lived session tokens, rate limits, daily spend budgets, sanitized output.
- **Knowledge base:** answers from your files via OpenAI file search, with citations linking to your pages.
- **Tools:** your own functions, defined with Zod schemas and validated end to end.
- **Attachments and images**, plus **voice input** (speech to text).
- **No database required:** conversations live in the OpenAI Conversations API. Add-ons are planned for teams that need their own storage.
- **Looks good out of the box:** four themes (Halo, Aura, Sage, Care) in light and dark. Every part can be customized, from configuration up to fully custom UI.

## Planned usage

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/chatdock/next';
import { bots } from '@/chatdock.config';

export const maxDuration = 300;
export const { GET, POST, DELETE } = createChatHandler({ bots });
```

```html
<script src="https://your-app.example.com/api/chat/widget.js" data-bot="support" async></script>
```

## Design decisions

The architecture is documented as [Architecture Decision Records](docs/adr/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Boldare
