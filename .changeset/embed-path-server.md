---
'@boldare/askdare': minor
---

A bot can show a page of your app in the widget's iframe instead of askdare's own (ADR-0018). Set `defineBot({ embedPath: '/askdare/support' })`, and the chat route redirects the iframe there with the visitor's language and the mode; the loader on the embedding sites doesn't change. `@boldare/askdare/next` adds `getEmbedConfig({ bots, bot, searchParams })`, the configuration for that page, and `embedPageHeaders({ bots, bot })`, the `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` headers it must send, for `headers()` in `next.config.ts`. `askdare doctor` follows the redirect and checks the page. `EmbedRoot`, which renders the chat on that page, comes in a later 0.4 step.
