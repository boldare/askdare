---
'@boldare/askdare': minor
---

`createChatHandler({ onUsage })` reports every chat turn once its answer has streamed, failed turns included: the tokens it used (input, cached and cache-write input, output and reasoning), the model that answered, how long it took and which tools it called, with pseudonyms instead of IDs and never any message text. Use it for cost tracking and tracing. `onError` may now be async too, and a hook that throws no longer reaches the request: askdare logs its error's name instead.
