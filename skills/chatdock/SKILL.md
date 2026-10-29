---
name: chatdock
description: Add, configure or troubleshoot the @boldare/chatdock AI chat in a Next.js app (defineBot, defineTool, createChatHandler, the widget script, themes, knowledge base, deployment). Use when the project depends on @boldare/chatdock or the user asks for a website chatbot built on it.
---

# chatdock

`@boldare/chatdock` serves an embeddable AI chat from a Next.js 16 app (App Router, Node.js runtime). The full guides are in `node_modules/@boldare/chatdock/docs/`; read the relevant one before changing anything. They match the installed version, unlike your memory of the API.

## Setup and checks

- New integration: `npx @boldare/chatdock init`. It writes `chatdock.config.ts`, `app/api/chat/[...path]/route.ts`, `.env.local` (with a generated `CHAT_SECRET`) and the script tag in the root layout, and never overwrites files.
- After any change to the config, the environment or the hosting: run the app, then `npx @boldare/chatdock doctor` (add `--url` and `--env-file` for a deployed app). Fix what it reports before anything else.
- Knowledge base: `npx @boldare/chatdock kb sync <folder>`, then set `KB_VECTOR_STORE_ID` to the ID it prints.

## Public API: use only this

- `defineBot`, `defineTool` from `@boldare/chatdock`; `createChatHandler` from `@boldare/chatdock/next`.
- On pages: `<script src="…/api/chat/widget.js?bot=<id>" async>` with `data-launcher="none"` or `data-mode="inline" data-target="…"`, and `chatdock('open' | 'close' | 'toggle' | 'configure', …)`.
- Styling: `widget.texts`, `widget.theme`, `widget.css` with `[data-cd-part="…"]` selectors and `--cd-*` tokens (see `docs/styling.md`).

Never import from `@boldare/chatdock/dist/…` or other internal paths.

## Rules

- `export const maxDuration = 300` must stay a literal in the route file. Don't set `runtime = 'edge'`.
- Keep `/api/chat` out of `proxy.ts` (or `middleware.ts`) matchers, of `headers()` in `next.config` and of anything that adds `X-Frame-Options`, a Content Security Policy or cookies.
- The model is the app owner's choice: never invent or swap a model ID; read it from config or ask. Model names change often, so check OpenAI's current model list.
- Secrets (`OPENAI_API_KEY`, `CHAT_SECRET`) belong in `.env.local` or the host's settings, never in code, instructions or commits. Never print them.
- Bot instructions must contain no secrets: visitors can make the model repeat them.
- Sites that embed the chat go in `security.allowedOrigins` as exact origins, without wildcards.
- Tools: every Zod field is required (use `.nullable()`, not `.optional()`). Never take user IDs, emails or permissions from tool arguments; use the verified `context` (`visitorId`, `botId`, `locale`, `signal`). Keep tools read-only.
- More than one server instance (Vercel, several dynos) needs shared limits: `@boldare/chatdock-upstash`.
