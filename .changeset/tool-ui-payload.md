---
'@boldare/askdare': minor
---

Tools can pick what the visitor sees of their result (ADR-0017). `defineTool({ ui: (result) => data })` returns plain JSON of at most 8 KB for a card, list or table; only that reaches the browser, never the result itself. The server sends it as a new `tool.ui` event after the call (additive within protocol version 1), and `POST /history` brings every answer's payloads back as `ui` after a reload. At most 4 per answer, in call order; a failed call, a throwing `ui` or a payload over the limits shows nothing. `Tool` now carries the tool's name and payload type (`Tool<Name, Ui>`), for typed React components with `toolRenderers`, which come next. Until then the payloads are kept on `ChatMessage.ui` but nothing draws them.
