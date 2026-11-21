---
'@boldare/askdare': minor
---

Public API clean-up before 1.0 (ADR-0020, ADR-0021).

- **`defineBot` now returns a `BotHandle`**, which exposes only `id` and `embedPath`. Pass it to `createChatHandler`, `getChatConfig` and `getEmbedConfig` as before. The resolved `Bot` type, with its filled-in defaults, is no longer exported. If you annotated a variable as `Bot`, use `BotHandle` (or `BotDefinition` for the input). Passing an object that didn't come from `defineBot` now throws a clear `TypeError`.
- **`ERROR_CODES` and `ErrorCode` are exported** from `@boldare/askdare`, so you can switch on the `code` that `onError` and the chat report.
- Node.js 26 joins the support matrix.
- `zod` stays a required peer: `defineBot` validates every definition with it.

Type-only removals can't warn at runtime a minor ahead, so this changeset names the replacements instead.
