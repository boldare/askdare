# ADR-0017: Tool results as React components (`toolRenderers`)

- **Status:** Accepted
- **Date:** 2026-11-20

## Context

[ADR-0015](0015-reply-options.md) shipped the first slice of tool UI in 0.3: a tool derives reply options from its own result, on the server, and only those strings reach the browser. It set the path for the rest: "the tool's code turns its result into a small, typed, size-capped payload; the server validates it and sends it as its own protocol event; the client renders it with known components, never with HTML from the server or the model."

Sites now want more than buttons: the open slots a booking tool found as a list, a product as a card, the plans of a pricing tool as a table. Today a tool's result never leaves the server, and the model retells it as text.

The rules that bound the design are the same as for replies:
- **[ADR-0004](0004-threat-model.md):** the client never chooses tools, flows, instructions or models.
- **[ADR-0003](0003-conversation-state.md):** no database. What the chat shows after a reload comes back from the OpenAI conversation.
- **[ADR-0011](0011-react-api-and-inline-chat.md):** answers render through the sanitized Markdown renderer, everything else as plain text; in a page there is no iframe CSP behind it.
- **[ADR-0013](0013-browser-events.md):** browser events carry metadata only.
- **[ADR-0006](0006-support-matrix-and-versioning.md):** the public surface stays small.

## Decision

### The payload: `defineTool({ ui })`

- **A tool declares `ui: (output) => Data | undefined`,** next to `replies`. Like `replies`, it is a function of the result as stored (parsed back from JSON, `Jsonified<Output>`), runs on the server in the developer's code, and only for a successful call. `undefined` or `null` sends nothing.
- **The tool's result still never reaches the client.** Only what `ui` returns does. `ui` is where the developer picks the fields a visitor may see; the docs say so in its JSDoc and in `docs/tools.md` (no prices for other customers, no internal IDs, nothing about other visitors).
- **`ui` must be pure and deterministic.** The live turn and a reload derive the payload from the same stored output (below), so they match as long as the tool's code doesn't change between them. A `ui` that throws defines nothing and is reported like a throwing `replies`.
- **Independent of `replies`.** A tool may define both; the precedence rules of ADR-0015 don't change.
- **Limits, enforced on the server and checked again in the client:**
  - the payload is plain JSON: objects, arrays, strings, finite numbers, booleans and `null`;
  - at most 8 KB serialized, and at most 8 levels deep;
  - at most 4 payloads per answer, in call order. Later ones are dropped, and the server logs the tool's name (never the payload) once per turn.

  A payload over a limit is dropped whole, never truncated, so a renderer never sees half a card.

### The protocol: a new `tool.ui` event

- **`tool.ui { messageId, callId, name, data }`,** additive in protocol version 1; older clients ignore unknown events. `name` is the tool's name, `callId` the same opaque ID as in `tool.status`. It is a separate event, not an extension of `replies`, because ADR-0015 gives each payload kind its own schema and limits.
- **Sent once the step's calls are done,** in call order, before the next model step, so a card can show while the model is still writing and the live turn orders cards as a reload does. It is never sent for a failed call.
- **History after a reload:** `HistoryMessage` gets an optional `ui: { callId, name, data }[]`. `openai/history.ts` rebuilds it from the stored `function_call` and `function_call_output` items with the bot's current tools, for **every** answer in the loaded page (at most 100 items), not only the latest as with replies: a card is part of the answer, an option is not. The calls of a turn attach to that turn's last visible answer, as in the live stream.
- **The browser core:** `ChatMessage.ui?: readonly ToolUi[]`, set by the reducer (hot files: `chat/state.ts`, `chat/reducer.ts`). The iframe stores the payloads like any other client.

### The API: `toolRenderers` on `Root`

- **`Root({ toolRenderers })`**, a map from a tool's name to a React component. It lives in the chat's context, so `DefaultChat` and every primitive inside the same `Root` see it; `DefaultChat` gets no prop of its own (one place to set it, and an ejected skin needs no change).
- **A new primitive `ToolResults`** (part `tool-results`, each card in a part `tool-result` with `data-ask-tool="<name>"`) renders the current message's payloads with the registered components, in call order. The default skin places it under the answer text, before the files and the citations. A headless chat places it wherever it wants.
- **A renderer gets `{ data, name, callId }`** and reads anything else through the hooks. To act, it calls `useChat().actions.send(text)`: a click sends a visitor message, exactly as a reply option does (ADR-0015). There is no other action, so a card can't select a tool, a flow or an instruction (ADR-0004).
- **Typed from `defineTool`.** `Tool` gets two type parameters with defaults, `Tool<Name extends string = string, Ui = unknown>`, and `defineTool` infers the name as a literal (a `const` type parameter) and `Ui` from `ui`'s return type. Two helper types are exported:
  - `ToolRendererProps<T extends Tool>`: `{ data: Jsonified<Ui>, name, callId }`;
  - `ToolRenderers<T extends readonly Tool[]>`: a map with an optional component per tool name.

  A page imports its tools with `import type`, so no server code reaches the client bundle: `const renderers = { find_slots: SlotList } satisfies ToolRenderers<[typeof findSlots]>`. `Root` itself takes the loose form, so the helpers are a convenience, never required.
- **Fallback:** a payload whose tool has no renderer renders nothing. The model saw the result and tells it in text anyway. When `Root` has `toolRenderers`, `ToolResults` warns in the console once per tool name without a component (changed during implementation: a check for development needs `process.env`, which the browser entry doesn't read; the iframe, which has no renderers, stays quiet). There is no generic JSON view: it would show visitors data the developer never designed for them.
- **A renderer that throws** is caught by an error boundary around each card. That card renders nothing and the chat goes on; in development the error is logged.

### Security

- **No raw HTML.** `data` is JSON and React escapes every string in it. The rule that forbids `dangerouslySetInnerHTML` in askdare's code can't reach the developer's renderers, so the docs state it as theirs.
- **Links go through the allowlist.** A new primitive `Link` renders an `<a>` whose `href` passes the same `safeUrl` check as links in answers (`https:`, `http:` and `mailto:`), opens in a new tab with `rel="noopener noreferrer nofollow"`, and renders plain text when the URL fails the check. The docs tell renderers to use it for any URL that came from a payload. React 19 also blocks `javascript:` URLs, but the iframe runs on Preact, which doesn't, so the check can't rely on it.
- **Images and other URLs that load something** (`img`, `background-image`) can leak data: a prompt injection can make the model call a tool with arguments that end up in a URL. The docs tell renderers to load only URLs the tool builds itself, never ones copied from the model's arguments.
- **The renderer is the developer's own code,** running with the page's rights (inline) or the iframe's (through `embedPath`, ADR from 3a). askdare guarantees what reaches it: a payload the developer's own `ui` function produced, within the limits.
- **No new browser event.** `tool.ui` stays inside the chat; ADR-0013's events don't carry payloads.

### Budget

- `@boldare/askdare/react` stays within its 32 KB budget, as `scripts/react-size.mjs` measures it. `ToolResults`, `Link` and the error boundary add about 450 bytes gzipped: 32,399 of 32,768 bytes after task 2c, so the next addition to the React entry needs room made first.
- The iframe app gains only the reducer case and the client check, since it registers no renderers.
- The loader doesn't change.

### The script-tag widget

The iframe renders askdare's own skin, which can't import a site's components. It receives and stores `tool.ui` events, and with no renderers registered shows nothing, as above. A site that wants cards in the script-tag widget serves its own page inside the iframe with `embedPath`, which renders `Root` with its `toolRenderers`; [ADR-0018](0018-embed-path.md) decides how.

## Evidence

Built in tasks 2b and 2c (November 2026):
- **Live and after a reload.** A live turn on the site's demo bot (OpenAI) sent `tool.ui` right after the call's `tool.status`, with only the fields `ui` picked; `POST /history` returned the same payload on the same answer. `e2e/tool-cards.spec.ts` checks this in Chromium, Firefox and WebKit against the mocked API, and that a click in a card goes out as the visitor's message.
- **The iframe is unchanged.** It receives the payloads and draws nothing; all of its visual baselines passed without an update. The chat inside a page got one new baseline, `inline-tool-card`.
- **Reviews.** A security review found nothing to fix; a code review moved the cap of four per answer from the OpenAI gateway into `server/stream-turn.ts`.

## Consequences

- **New public API (ADR-0006, a minor version in 0.x):**
  - the `ui` option of `defineTool`, and the type parameters of `Tool`;
  - the `tool.ui` protocol event and the `ui` field in the history response (additive in protocol version 1);
  - `toolRenderers` on `Root`, the primitives `ToolResults` and `Link`, the parts `tool-results` and `tool-result`, and the types `ToolRendererProps`, `ToolRenderers` and `ToolUi`.
- **History reads function calls for every answer,** not only the latest. It stays inside the one page of items it already loads, so it costs CPU, not requests.
- **A turn that ends without a visible answer** (an error, `max_steps`) shows its cards live, on the empty answer, but not after a reload, where there is no answer to attach them to. Showing them on the visitor's message instead would put a card where the visitor never saw one; this is accepted.
- **The cap of four per answer is the server's,** in `server/stream-turn.ts`, not each gateway's, so a second `ModelGateway` (spike S6) can't send more.
- **A card can change after a deploy:** a reload derives it with the tool's current `ui`. Storing the payload would need a database (ADR-0003); this is accepted and documented.
- **The model still writes about the result.** Developers who want the card to speak for itself say so in the tool's description or the bot's instructions; askdare doesn't hide the text.
- **Cards don't reach the script-tag widget until `embedPath` ships.** The bytes of `tool.ui` events are sent to it anyway; at most 32 KB per answer.

## Alternatives considered

- **`execute` returning `{ result, ui }`.** Rejected for the same reason as `{ result, replies }` (#47): it gives `execute`'s return value two meanings, and a reload couldn't rebuild the payload from what is stored.
- **Storing the payload in the conversation** (for example as conversation item metadata) so a reload shows what the live turn showed. Metadata is small and string-valued, and the stored output already holds everything `ui` needs. Deriving keeps one source of truth.
- **Extending the `replies` event** with a payload. Replies are plain text with their own rules, sent once per answer; cards are per call and structured. Mixing them would loosen the replies schema.
- **A Zod schema for the payload, checked on the server.** The developer's `ui` already returns their own typed data; a second schema doubles the declaration. The server checks only what matters to askdare (plain JSON, size, depth), and the client can't run Zod within its budget.
- **Server-rendered HTML or React Server Components for cards.** HTML from the server is exactly what ADR-0011 rules out, and RSC payloads can't reach the Preact iframe or a page outside the Next app.
- **A generic fallback that shows the payload.** It would put data on screen that nobody designed for visitors.
- **`toolRenderers` on `DefaultChat` as well.** Two places to set one thing, and they could disagree; the context of `Root` already reaches `DefaultChat`.
- **Cards that trigger server actions (a button that calls a tool directly).** Against ADR-0004, as in ADR-0015. If a flow ever needs it, it gets its own ADR.
