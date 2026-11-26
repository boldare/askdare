---
'@boldare/askdare': minor
---

The headless chat now knows about handoffs and forms (ADR-0030, ADR-0031). An answer's `handoff` holds where a handoff to a person stands (`requested`, then `sent`, `saved`, `unavailable`, `failed` or `limited`), and its `forms` the forms shown under it, each `open`, `submitting`, `sent` or `expired`, with the server's error key per refused field. Both come from the stream and from the history. `actions.handoff()` asks for a person from the latest answer (the "Talk to a person" button), and `actions.submitForm(handle, values)` sends a form. `ChatConfig.forms` carries the bot's forms in the visitor's language and follows a language switch.

"Reconnecting…" now goes away as soon as a dropped answer is resumed, instead of staying until its next text or status.
