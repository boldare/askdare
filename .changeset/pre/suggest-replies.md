---
'@boldare/askdare': minor
---

Reply options suggested by the model (ADR-0015). With `widget.replies: 'suggest'`, a bot gets the built-in tool `suggest_replies`: the model can offer 2–4 short replies under an answer, which visitors click instead of typing. The server answers the call itself (no bot code runs), cleans the options up and sends them in the `replies` event; after a reload, the history brings back the options of the latest answer. When the model suggests them after its answer, the message ends without another model call; otherwise it takes one more. `suggest_replies` is now a reserved tool name. Off by default: it costs about 250 input tokens per model call, and sometimes a model call (docs/costs.md).
