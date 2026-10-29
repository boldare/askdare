---
"@boldare/chatdock": minor
---

Add `defineTool()`: server-side functions the model can call, with Zod-validated arguments (OpenAI strict mode, checked at startup), parallel execution, per-tool timeouts, an output size cap and verified context (`botId`, `visitorId`, `locale`, `signal`). Failures go back to the model, never to the visitor; the last step must answer in text; and a call left without output by an interrupted turn is repaired automatically. The widget shows "Using <tool>…" while a tool runs.
