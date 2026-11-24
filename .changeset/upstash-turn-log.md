---
'@boldare/askdare-upstash': minor
---

New `upstashTurnLog()`: keeps the events of answers being generated in Upstash Redis, so a visitor whose connection drops can resume the answer on any server instance, not only the one that wrote it (ADR-0027). Pass it as `createChatHandler({ resume: { log: upstashTurnLog() } })` once the `resume` option ships in `@boldare/askdare` 0.6. It takes the same connection options as `upstashStore()` (`url`, `token`, `redis`, `prefix`) and `pollMs`, how often a waiting reader checks for new events (default 150 ms, since Upstash's REST API can't block on a stream).

Each answer is a Redis stream that holds the answer's text and expires a few minutes after its last event; the add-on logs nothing about it. Mention the database in your privacy notice.
