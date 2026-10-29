---
"@boldare/chatdock": minor
---

New commands. `npx @boldare/chatdock init` adds chatdock to a Next.js app: the route, a bot config, `.env.local` with a generated `CHAT_SECRET`, the chat script in the root layout and a note for AI coding agents in `AGENTS.md`, never overwriting files. `npx @boldare/chatdock doctor` checks the project, its environment and the running app, local or deployed: the OpenAI key, models, vector store, the key's permissions, and headers or proxies that would block the chat. The package now ships its guides in `docs/` and an `llms.txt`.
