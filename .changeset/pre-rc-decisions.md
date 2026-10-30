---
'@boldare/askdare': minor
---

Decisions before the first release candidate:

- `safety_identifier` is an HMAC of the visitor's or user's ID, keyed from `CHAT_SECRET`, instead of a plain SHA-256 that a guessable user ID could reverse. It changes when the secret rotates.
- Each answer in a resumed conversation ends with a fresh resume token (`message.end.resumeToken`), so an active conversation stays reachable 30 days after its last message rather than its first.
- When a bot's or the global budget runs out, the server logs it once a day and passes it to `onError` as `budget_exceeded`. Per-visitor and per-IP budgets are never reported.
- Messages accept every locale `defineBot` accepts, extensions such as `en-u-nu-latn` included.
- A fixed `widget.locale` with your own `widget.texts` sets the chat document's `lang` to that locale, so screen readers read a translation in its language.
- `content_blocked` is documented as reserved; compaction is planned for 0.2 (ADR-0003).
