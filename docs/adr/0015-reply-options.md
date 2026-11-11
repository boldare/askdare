# ADR-0015: Reply options and tool UI payloads

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

Site owners want clickable answers under a bot's reply ("Yes, book it", "Show prices", "Talk to a person"), as Intercom and Drift have. Two sources make sense:
- **The model suggests them** from the conversation: likely next questions.
- **A tool defines them** from its result: the open slots a booking tool found, the plans a pricing tool returned.

The second is the first, smallest case of a wider need: a tool's result shown as UI, not as text. [ADR-0008](0008-ui-customization-and-themes.md) and [ADR-0011](0011-react-api-and-inline-chat.md) planned `toolRenderers` (React components for tool results) for 0.3. Today the client sees only a tool's name and state (`tool.status`); its result never leaves the server.

The rules that bound the design:
- **[ADR-0004](0004-threat-model.md):** the client never chooses tools, flows, instructions or models. A button can't trigger anything a typed message couldn't.
- **[ADR-0003](0003-conversation-state.md):** no database. Whatever the chat shows after a reload must come back from the OpenAI conversation.
- **ADR-0011:** answers render through the sanitized Markdown renderer; everything else renders as plain text.
- **[ADR-0013](0013-browser-events.md):** browser events carry metadata only.

## Decision

### Common foundation

Both sources produce the same thing and share everything after it.

- **Protocol:** a new event `replies { messageId, items: string[] }`, sent before `message.end`. It is additive in protocol version 1: older clients ignore unknown events. At most one per answer.
- **Limits, enforced on the server and checked again in the client:** at most 4 items of at most 80 characters, trimmed, non-empty and without duplicates. An item that contains a URL is dropped. If nothing is left, no event is sent.
- **State:** `ChatMessage.replies?: readonly string[]` in the browser core, set by the reducer.
- **UI:** a headless primitive `QuickReplies` with the parts `replies` (the group) and `reply` (each button), plus the default look in the skin. It is shown only under the **latest** assistant answer, and disappears once the visitor sends anything.
- **Rendering:** each item is rendered as plain text, never as Markdown, so a reply can't carry links, images or formatting.
- **A click is a visitor message.** It calls `actions.send(text)` with the item's text, exactly as if the visitor had typed it. The server can't tell the difference and doesn't need to: the message goes through the same limits and budgets as any other, and no tool, flow or instruction is selected by the click.
- **Events (ADR-0013, additive):** `message.sent` gets `source: 'reply'`.
- **History after a reload:** `openai/history.ts` rebuilds the replies of the last answer from the stored `function_call` items (and, for tool-defined replies, their `function_call_output`), which it skips today. The history response gets an optional `replies` on that message.
- **Precedence:** if a tool defined replies in a turn, the model's suggestion for that turn is ignored.

### Variant A: model-suggested replies

- **Opt-in per bot:** `widget.replies: 'suggest'`. The default is off.
- **A built-in, reserved tool `suggest_replies`** with one argument, `items: string[]`. Its description tells the model to call it, at most once, when a few short next steps would help the visitor. `defineBot` rejects a bot tool with that name.
- **The server answers the call itself** with a fixed output, because a call without an output breaks the next turn (spike S1, ADR-0003). It runs no bot code.
- **Cost:** the tool's definition adds input tokens to every step (inside the cached prefix), and when the model calls it before it has written its answer, the turn takes one more model step. The cost guide documents this.
- **The last step:** `toolChoice()` in `openai/tools.ts` forbids function tools on the turn's last step (only `file_search` stays), so a call there could not be answered. On that step the model can't suggest replies. Whether the call can be answered without another model call when it comes after the answer is checked against the OpenAI docs and in a spike before implementation.

### Variant B: tool-defined replies

- **A tool derives replies from its own result** on the server, in the developer's code, not the model's. Two shapes are on the table:
  - `defineTool({ ..., replies: (output) => string[] })`, a function of the tool's result;
  - `execute` returning `{ result, replies }`, where only `result` goes to the model.

  The implementation picks one (or both); the protocol, the limits and the UI don't depend on it. The second shape is ambiguous for a tool whose real result has those keys, which favors the first.
- **The tool's result still never reaches the client.** Only the replies do, after the same limits.
- **This is the first slice of tool UI payloads.** `toolRenderers` will follow the same path: the tool's code turns its result into a small, typed, size-capped payload; the server validates it and sends it as its own protocol event; the client renders it with known components, never with HTML from the server or the model. Each new payload kind gets its own event schema and limits.

## Consequences

- **New public API ([ADR-0006](0006-support-matrix-and-versioning.md)):**
  - the `replies` protocol event and the `replies` field in the history response (additive in protocol version 1);
  - `QuickReplies` and the `replies` and `reply` parts;
  - `widget.replies` and the reserved tool name `suggest_replies`;
  - the `replies` option of `defineTool` (or the `{ result, replies }` shape);
  - `source: 'reply'` in the event catalog.
- **Security holds without new rules.** A reply is model or tool output shown as text and sent back as the visitor's own words. A prompt injection (for instance in a knowledge-base document) can at worst suggest misleading text the visitor then chooses to send, which they could also have typed.
- **The visitor's message is the reply's text,** so the transcript, `onUsage` and analytics stay simple.
- **Variant A costs tokens,** and sometimes a step. That is why it's opt-in.
- **Model-suggested replies are in the answer's language,** so they follow a language switch from the next answer on ([ADR-0014](0014-runtime-language.md)).
- **History has to understand function calls** for the first time. The mapper still shows only user and assistant messages; replies attach to the last answer only, so older turns aren't parsed.

## Alternatives considered

- **Structured output (`text.format` with a JSON schema) holding the answer and the replies.** Rejected:
  - it fights tools: every step's final text must match the schema, including the step after a tool call;
  - it breaks citations: `file_search` annotations point into the output text, which would then be JSON;
  - it breaks streaming: the visitor would see JSON fragments, or the client would need a partial JSON parser to stream the answer field.
- **Parsing a marker out of the answer text** (for example a list after `---`). Fragile, visible while streaming, and easy for a prompt injection to imitate.
- **Buttons that carry an action ID the server acts on** (a flow or tool selected by the click). It lets the client choose server behavior, against ADR-0004. If a flow ever needs it, it gets its own ADR.
- **Replies under every answer.** Old suggestions go stale and invite clicks that make no sense later in the conversation.
- **Markdown in replies.** A button needs no formatting, and plain text removes a whole class of injection.
- **Full `toolRenderers` first.** A typed, sanitized payload path is easier to get right with one small payload (a list of strings) than with arbitrary components.
