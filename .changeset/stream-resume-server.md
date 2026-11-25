---
'@boldare/askdare': minor
---

A visitor whose connection drops in the middle of an answer no longer loses it: the server keeps the answer's events for a few minutes, and a client can continue from the last one it received with the new `POST /resume` (ADR-0027). The widget, the chat inside a page and the headless API use it.

- Every event frame of `POST /messages` now carries an SSE `id:`, the event's sequence number in its turn. `POST /resume` takes `{ botId, resumeToken, messageId, after }` and streams the events after `after`, then the live ones, until `message.end` or `error`, each once. An answer that is unknown, expired or not the visitor's answers `404`. Additive within protocol version 1; see [Protocol](docs/protocol.md#resuming-an-answer).
- `createChatHandler({ resume: { log } })` chooses where answers' events are kept. The default, `memoryTurnLog()`, keeps them per instance, so a reconnect to another instance reloads the conversation instead. With several instances, use `upstashTurnLog()` from `@boldare/askdare-upstash`. New exports: `memoryTurnLog`, `MemoryTurnLog`, `MemoryTurnLogOptions`, `TurnEventLog` and `TurnEvent` from `@boldare/askdare`, `ChatHandlerResumeOptions` from `@boldare/askdare/next`, and `turnEventLogContract` with `TurnEventLogContractOptions` from `@boldare/askdare/testing`, to test your own log.
- Privacy: the log holds the text of answers being written, under an HMAC, for the bot's turn timeout plus one minute after each answer's last event (three minutes by default). Nothing about it is logged. See [Privacy](docs/privacy.md#turn-log).
