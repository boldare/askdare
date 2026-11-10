# @boldare/askdare-otel

## 0.1.0-rc.0

### Minor Changes

- e3e51ba: New add-on: `otelUsage()` records every askdare chat turn as OpenTelemetry spans for `createChatHandler({ onUsage })`. Each turn is a `chat <model>` span with token counts, the finish reason and pseudonyms; each tool call is an `execute_tool <name>` span inside it. Attributes follow the GenAI semantic conventions, and no message text is recorded.

### Patch Changes

- Updated dependencies [1a1659f]
- Updated dependencies [7c9fb36]
- Updated dependencies [9bd1b16]
- Updated dependencies [05076dc]
- Updated dependencies [45ef7de]
- Updated dependencies [48ddabf]
- Updated dependencies [94a1e30]
  - @boldare/askdare@0.2.0-rc.0
