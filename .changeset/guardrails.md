---
'@boldare/askdare': minor
---

Guardrails, all opt-in and set in `defineBot` (ADR-0019). A bot that sets none of them behaves exactly as before.

- `moderation: { model, check?, categories?, message? }` runs OpenAI moderation on visitors' messages (`check: 'input'`, the default), on answers (`'output'`) or both. You choose the moderation model, which categories block (default: any flagged one) and the text visitors see. Each checked message adds one call to OpenAI's moderation endpoint.
- `onInput(text, context)` and `onOutput(text, context)` return `{ action: 'allow' }` (or `undefined`), `{ action: 'block', message? }` or `{ action: 'redact', text }`. A hook that throws lets the text through and logs one line naming the hook.
- While answers are checked (`onOutput`, or moderation of output), they are held back on the server until complete, then sent whole, replaced or blocked; reasoning and tool status still stream. A blocked answer never reaches the browser, and a replaced one comes without its tool cards and reply options. For these bots the history shows an answer only once its check passed, and a conversation takes one turn at a time (a second message meanwhile gets `rate_limited`).
- Blocked turns end with the existing `content_blocked` error, with your text or the translated default. Nothing blocked or redacted is logged as content. Attached files are not checked.
- `toolResults: 'untrusted'` hands tool results to the model wrapped as third-party data that it must not follow as instructions. Recommended for tools that return text from outside your control.

New exported types: `GuardrailOptions`, `ModerationConfig`, `GuardHook`, `GuardVerdict` and `GuardContext`. See `docs/guardrails.md`.
