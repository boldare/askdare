---
name: askdare
description: Add, configure or troubleshoot the @boldare/askdare AI chat in a Next.js app (defineBot, defineTool, createChatHandler, the widget script, the React chat inside a page, tool cards, your own page in the widget's iframe, themes, knowledge base, reply options, the chat's language, answer ratings, usage reports, guardrails and moderation, the Turnstile human check, the AI notice, accessibility, deployment, conversations and knowledge in your own Postgres, resuming answers, compaction, transcripts). Use when the project depends on @boldare/askdare or the user asks for a website chatbot built on it.
---

# askdare

`@boldare/askdare` serves an embeddable AI chat from a Next.js 16 app (App Router, Node.js runtime). The full guides are in `node_modules/@boldare/askdare/docs/`; read the relevant one before changing anything. They match the installed version, unlike your memory of the API.

## Setup and checks

- New integration: `npx @boldare/askdare init`. It writes `askdare.config.ts`, `app/api/chat/[...path]/route.ts`, `.env.local` (with a generated `CHAT_SECRET`) and the script tag in the root layout, and never overwrites files.
- After any change to the config, the environment or the hosting: run the app, then `npx @boldare/askdare doctor` (add `--url` and `--env-file` for a deployed app). Fix what it reports before anything else.
- Knowledge base: `npx @boldare/askdare kb sync <folder>`, then set `KB_VECTOR_STORE_ID` to the ID it prints; or `kb sync <folder> --index <id>` for your own index in Postgres (below).
- Something fails: `docs/troubleshooting.md` lists symptoms, causes and fixes by error code. In development the server log says what is wrong with the setup; so does the chat when a reply fails.
- Every option, limit and default: `docs/configuration.md`; every CLI flag: `docs/cli.md`; script tag attributes and the host page's CSP: `docs/embedding.md`.

## Public API: use only this

- `defineBot`, `defineTool`, `defineTheme`, `turnstile` and `ERROR_CODES` from `@boldare/askdare`; `defineBot` returns a `BotHandle` (only `id` and `embedPath`): pass it to `createChatHandler`, `getChatConfig` and `getEmbedConfig`, and type it as `BotHandle` (or `BotDefinition` for the input), never as `Bot`; `createChatHandler` from `@boldare/askdare/next`, with its `onError`, `onUsage`, `onFeedback`, `onTranscript`, `conversations` and `resume` options; `memoryConversations`, `memoryTurnLog` and `openaiEmbedder` from `@boldare/askdare`; `postgresConversations` and `pgvectorIndex` from `@boldare/askdare-postgres`; `upstashStore()` and `upstashTurnLog()` from `@boldare/askdare-upstash`; `otelUsage()` from `@boldare/askdare-otel`.
- On pages: `<script src="…/api/chat/widget.js?bot=<id>" async>` with `data-launcher="none"` or `data-mode="inline" data-target="…"`, and `askdare('open' | 'close' | 'toggle' | 'configure', …)`.
- The chat's language on the page, for a bot with `locale: 'auto'`: `askdare('configure', { locale: 'pl' })`, or `data-follow-lang` on the script tag to follow `<html lang>`. The chat reloads in the new language and keeps the conversation; your `instructions` get it as `context.locale`. See `docs/texts.md`.
- Reply options (clickable answers under the latest reply): `widget.replies: 'suggest'` lets the model suggest them; `defineTool({ replies: (result) => [...] })` derives them from a tool's result. See `docs/reply-options.md`.
- The chat inside a page of the same Next.js app (React 19): `getChatConfig` from `@boldare/askdare/next` in a Server Component, then `Root`, `DefaultChat`, the hooks (`useChat`, `useChatState`, `useMessage`) and the primitives from `@boldare/askdare/react` (see `docs/react.md`). To change the default components, run `npx @boldare/askdare add ui`; don't copy them from `node_modules` by hand.
- Tool cards: `defineTool({ ui: (result) => data })` picks what the visitor may see of a result (plain JSON, at most 8 KB; only that reaches the browser), and `Root`'s `toolRenderers={{ tool_name: Component }}` draws it, typed with `Chat.ToolRendererProps<typeof tool>` and `import type`. Render `data` as text and URLs through `Chat.Link`. See `docs/react.md#tool-cards`.
- Your own page in the widget's iframe: `defineBot({ embedPath: '/askdare/support' })`; the page lives in its own route group and root layout, renders `<EmbedRoot config={getEmbedConfig({ bots, bot, searchParams })}>` from `@boldare/askdare/embed` with `DefaultChat` inside, and gets `embedPageHeaders({ bots, bot })` from `proxy.ts` (not `next.config.ts` headers, which are fixed at build). Check with `askdare doctor --origin <site>`. See `docs/embedding.md#your-own-page-in-the-iframe`.
- Guardrails, all opt-in in `defineBot` (see `docs/guardrails.md`): `moderation: { model, check?, categories?, message? }` runs OpenAI moderation on messages (`check: 'input'`, the default), answers (`'output'`) or both; `onInput(text, context)` and `onOutput(text, context)` return `{ action: 'allow' }`, `{ action: 'block', message? }` or `{ action: 'redact', text }`; `toolResults: 'untrusted'` marks tool results as third-party data. While answers are checked, they arrive whole at the end of the turn, and a conversation takes one turn at a time.
- Human check (see `docs/configuration.md#human-check`): `security: { humanVerifier: turnstile({ siteKey }) }`, with `TURNSTILE_SECRET_KEY` in the environment. A chat inside your page must allow `https://challenges.cloudflare.com` in its CSP, and a headless chat renders the `HumanCheck` primitive. `createChatHandler({ limits: { requireSharedStore: true } })` refuses to load without a shared store.
- The AI notice: on by default (`widget.disclosure`). In your own markup, or your own page in the iframe, render the `Disclosure` primitive; in development the console notes a chat without one.
- Built-in texts in en, cs, de, es, fr, it and pl; `widget.texts` overrides them per language (see `docs/texts.md`).
- Styling: `widget.texts`, `widget.theme`, `widget.css` with `[data-ask-part="…"]` selectors and `--ask-*` tokens (see `docs/styling.md`).
- Long conversations load older messages in pages: `DefaultChat` shows `LoadEarlier`; in your own markup, put `LoadEarlier` first inside `Messages` or call `actions.loadEarlier()` (see `docs/react.md#long-conversations`).

## Own your data

By default there is no database: OpenAI keeps the conversations, and the knowledge base is a vector store. Move to Postgres only when the site needs it (Zero Data Retention, data residency, its own retention and erasure, long conversations); `docs/own-your-data.md` is the step-by-step guide, so follow it rather than this summary.

- Conversations: `npm install @boldare/askdare-postgres`, `DATABASE_URL` in `.env.local`, `npx askdare-postgres migrate`, then `createChatHandler({ conversations: postgresConversations() })`. Run `migrate` before every deployment that brings a new add-on version (Vercel: in the build command; Heroku: a `release:` phase), with the direct connection string, not a transaction pooler. Existing OpenAI conversations aren't copied: returning visitors start a new one. `memoryConversations()` is for tests.
- Knowledge: set `ASKDARE_EMBEDDING_MODEL` and `ASKDARE_EMBEDDING_DIMENSIONS` (the owner picks the embedding model, as with `ASKDARE_MODEL`), run `npx @boldare/askdare kb sync <folder> --index <id>`, then give the bot `knowledge: { index: pgvectorIndex({ embedder: openaiEmbedder({ model, dimensions }), indexId: '<id>' }) }` with the same model, size and ID. A bot has `vectorStoreId` or `index`, not both; the own index reads Markdown, MDX, text and HTML only. See `docs/knowledge-base.md#your-own-index`.
- Resume after a dropped connection is on by default, in memory, which is enough for one server. On Vercel or several instances: `createChatHandler({ resume: { log: upstashTurnLog() } })`. See `docs/configuration.md#resume`.
- Compaction: `limits: { compactAt: 40_000 }` in `defineBot` (20,000–272,000 tokens), only with a store that keeps the items, such as `postgresConversations()`; the default store never compacts. See `docs/configuration.md#compaction`.
- Transcripts: askdare stores none. `createChatHandler({ onTranscript })` receives each finished turn's message and answer, for the app to save. See `docs/configuration.md#ontranscript`.
- After the move, `doctor` checks the store's schema and the index's sync; fix what it reports.

Never import from `@boldare/askdare/dist/…` or other internal paths.

## Rules

- `export const maxDuration = 300` must stay a literal in the route file. Don't set `runtime = 'edge'`.
- Keep `/api/chat` out of `proxy.ts` (or `middleware.ts`) matchers, of `headers()` in `next.config` and of anything that adds `X-Frame-Options`, a Content Security Policy or cookies.
- The model is the app owner's choice: never invent or swap a model ID; read it from config or ask. Model names change often, so check OpenAI's current model list.
- Secrets (`OPENAI_API_KEY`, `CHAT_SECRET`) belong in `.env.local` or the host's settings, never in code, instructions or commits. Never print them.
- Bot instructions must contain no secrets: visitors can make the model repeat them.
- Sites that embed the chat go in `security.allowedOrigins` as exact origins, without wildcards.
- With `@boldare/askdare/react`: never render `message.text` as HTML (use `MessageText` or `Markdown`); sign a visitor out with `identity={null}`, since `undefined` keeps the current one; a page that passes `identity` must not be cached; on pages with third-party scripts, prefer the script-tag widget.
- Tools: every Zod field is required (use `.nullable()`, not `.optional()`). Never take user IDs, emails or permissions from tool arguments; use the verified `context` (`visitorId`, `botId`, `locale`, `identity`, `signal`). Keep tools read-only.
- Signed-in users: the site's backend signs an HS256 JWT with `IDENTITY_SECRET` (`sub`, `aud` = bot ID, `iat`, `exp`), and the page calls `askdare('identify', token)` (`null` on sign-out). See `docs/identity.md`.
- Tool cards: `ui` must be pure (it runs again on every reload) and must return only fields a visitor may see; never render its `data` as HTML, and load images only from URLs the tool builds itself.
- Reply options: at most 4, up to 80 characters each, plain text without links; anything else is dropped. A click only sends the option's text as the visitor's message, so write options the way a visitor would say them ("Cancel the order"), never as commands or IDs, and never treat a clicked option as more trusted than typed text.
- More than one server instance (Vercel, several dynos) needs shared limits, and a shared turn log for resume: `upstashStore()` and `upstashTurnLog()` from `@boldare/askdare-upstash`.
- Answer ratings (👍/👎) show only with `createChatHandler({ onFeedback })`; `widget.feedback: false` hides them for one bot. askdare stores no ratings: save the report in `onFeedback`. A rating's `comment` is visitor text: escape it wherever it is shown, and cover it in the privacy notice. See `docs/feedback.md`.
- Guardrail hooks must not throw to block: a hook that throws lets the text through (fail open) and logs one line. Moderation and hooks don't check attached files; keep `attachments` off where that matters. Never log the text a hook receives.
- Accessibility: keep `Messages` and its `announcement` part, and don't add your own live region for answers; screen readers hear each finished answer once (see `docs/accessibility.md`).
- Compliance and privacy: `docs/compliance.md` and `docs/privacy.md`. Name Cloudflare in the privacy notice when the human check is on, and OpenAI's moderation when `moderation` is.
- Costs and tracing: `onUsage` (or `onUsage: otelUsage()` from `@boldare/askdare-otel`). Its reports hold pseudonyms and counts, never message text; don't add any. See `docs/observability.md`.
- Your own store: the user that runs `migrate` owns the tables, and the app's user needs only `select`, `insert`, `update` and `delete`; askdare never changes the schema while it serves. Conversations and transcripts in your database are personal data: give them a retention and sweep them on a schedule (`docs/own-your-data.md#8-sweep-old-conversations`). Deleting a conversation calls no hook, so sweep transcripts too. Never log what `onTranscript` receives.
- Never tell the owner that data no longer goes to OpenAI: with your own store, OpenAI still processes every request, and attachments stay in OpenAI Files. Use the wording of `docs/own-your-data.md#what-stays-at-openai`.
