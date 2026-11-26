---
'@boldare/askdare': minor
---

When a visitor's connection drops in the middle of an answer, the chat now carries on with the rest of it instead of showing an error, in the widget, in the chat inside a page and with the headless API.

- **How:** a stream that ends before the answer did is resumed with `POST /resume`, after the last event the chat received, so no text is shown twice. It tries after half a second, then 2 and 8 seconds while nothing new comes, and at most ten times for one answer. Meanwhile the status says "Reconnecting…", which screen readers hear politely.
- **When it can't be resumed** (the server no longer has the answer's events, as with the default in-memory log on another instance, or the attempts ran out), the chat reloads the latest page of the conversation and shows the finished answer from there. Older pages already shown stay. Only when the answer isn't stored yet does the chat show "Connection problem. Please try again." as before.
- **Headless:** `state.activity` is `status.reconnecting` while an answer resumes. `message.received` fires once per answer, as `completed` when it was resumed or taken from the history.
- **New text:** `status.reconnecting`, in every built-in language.
- **Smaller React bundles:** a page that uses `Root` and `useChat` without `Markdown` no longer bundles the Markdown renderer (about 1.2 KB gzipped less), and `@boldare/askdare/react` no longer ships the parts of marked it never used, only its lexer (about 3 KB gzipped less). Answers render as before.

Resuming across instances needs a shared turn log, such as `upstashTurnLog()`. See [Configuration: `resume`](https://github.com/boldare/askdare/blob/main/docs/configuration.md#resume) and [Troubleshooting](https://github.com/boldare/askdare/blob/main/docs/troubleshooting.md#the-chat-reconnects-in-the-middle-of-an-answer).
