---
'@boldare/askdare': minor
---

A bot can show a page of your app in the widget's iframe instead of askdare's own (ADR-0018). Set `defineBot({ embedPath: '/askdare/support' })`, and the chat route redirects the iframe there with the visitor's language and the mode; the loader on the embedding sites doesn't change. `@boldare/askdare/next` adds `getEmbedConfig({ bots, bot, searchParams })`, the configuration for that page, and `embedPageHeaders({ bots, bot })`, the `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` headers it must send, to send from `proxy.ts`. `askdare doctor` follows the redirect and checks the page: no redirect in front of it, `EmbedRoot` on it, who may frame it and the microphone rule. The page renders the chat with `EmbedRoot` from `@boldare/askdare/embed`.
