---
'@boldare/askdare-otel': minor
---

New add-on: `otelUsage()` records every askdare chat turn as OpenTelemetry spans for `createChatHandler({ onUsage })`. Each turn is a `chat <model>` span with token counts, the finish reason and pseudonyms; each tool call is an `execute_tool <name>` span inside it. Attributes follow the GenAI semantic conventions, and no message text is recorded.
