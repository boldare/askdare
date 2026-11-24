---
'@boldare/askdare': minor
---

`createChatHandler({ onTranscript })` hands you each finished turn, so you can keep your own transcripts with any conversation store (ADR-0016). It is off unless you set it, and it is the only hook that receives message content.

- It gets what the visitor sent, after `onInput` (a redacted message arrives redacted), and the answer they saw, after output checks: the replacement of a replaced answer, nothing of a withheld one. With it come the answer's sources, the number of attached files, the end reason, the output check's verdict, and the identifiers `onFeedback` gets: the bot, the visitor's pseudonym, the signed-in user and the raw conversation and answer IDs. Never instructions, page context, file names, tool calls or their results.
- It runs after the answer has streamed and the conversation is free for the next message, kept alive with Next.js `after`. It isn't called for blocked messages or for turns that failed before their answer finished.
- Nothing it throws reaches the chat. `onError` receives an `internal_error` that names only the error's class, never its message, so a failed database write can't put the visitor's text in your logs.
- New types `ChatTranscriptReport` and `ChatTranscriptCitation` in `@boldare/askdare/next`. See [Configuration](docs/configuration.md#ontranscript) and [Privacy](docs/privacy.md#transcripts).
