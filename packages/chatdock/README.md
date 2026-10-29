# @boldare/chatdock

An AI chatbot for any website, served by your Next.js app and built on the official OpenAI SDK. One route file, one `<script>` tag, no database.

- Embeds anywhere through a small loader and an isolated iframe, limited to the sites you list.
- Secure by default: short-lived session tokens, rate limits, daily token budgets, sanitized output.
- Knowledge base with citations, your own tools, image and PDF attachments, voice input.
- Four themes in light and dark, English and Polish texts, customizable down to your own CSS.

## Quick start

In a Next.js 16 app with the App Router:

```bash
npm install @boldare/chatdock zod
npx @boldare/chatdock init      # route, bot config, .env.local and the chat script
# set OPENAI_API_KEY and CHATDOCK_MODEL in .env.local
npm run dev
npx @boldare/chatdock doctor    # checks the key, model, permissions and headers
```

## Documentation

The guides ship with the package in `node_modules/@boldare/chatdock/docs/`, starting with `getting-started.md`. They are also on [GitHub](https://github.com/boldare/chatdock/tree/main/docs). AI coding agents can start from `node_modules/@boldare/chatdock/llms.txt`.

## Requirements

Node.js 22 or later, Next.js 16 with the App Router on the Node.js runtime, React 19 and zod 4.1 or later. The full matrix, browsers included, is in `docs/support.md`.

## License

MIT © Boldare
