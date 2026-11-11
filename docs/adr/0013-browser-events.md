# ADR-0013: Chat events in the browser, metadata only

- **Status:** Accepted
- **Date:** 2026-11-11

## Context

The server hooks (ADR-0012) tell the app's backend what a turn cost and how visitors rated it. The page itself learns nothing. The `askdare()` API of the script tag only sends commands (`open`, `close`, `toggle`, `configure`, `identify`), and the chat runs in an iframe the page can't look into. A React app can watch `useChatState`, but turning state changes into "a message was sent" takes diffing in effects, which breaks with every change to the state's shape.

Site owners ask for the same things they get from Intercom or Crisp:
- analytics events (GA4, a GTM `dataLayer`) for an opened chat, a question asked and a rated answer;
- page reactions, such as hiding the page's own call to action while the chat is open.

Whatever the page gets, the scripts on it get too, and those are often third parties. ADR-0004 keeps message content out of logs for the same reason.

## Decision

### One catalog for both entry points

The browser chat emits these events, each with `type` and `bot`:

| type | fields |
|---|---|
| `ready` | none. Fires once per chat, when it can take messages: not while loading the stored conversation fails. |
| `open`, `close` | none. Script tag only: the visitor or the page opened or closed the panel. |
| `message.sent` | `length` (characters, as code points), `attachments` (count), `source`: `typed` or `starter`. |
| `message.received` | `outcome`: `completed`, `failed`, or `stopped` when the chat is taken down mid-answer (a `Root` unmounting; closing the widget's panel doesn't stop an answer); `durationMs`; `citations` (count). The chat reports `stopped` before its listeners go. |
| `feedback` | `rating`: `up`, `down` or `null`; `commented`. Fires once the server took the rating, so a 👎 and its comment fire twice. |
| `error` | `code`, an `ErrorCode`. |
| `conversation.reset` | none. |

### Metadata only

An event never carries message text, comments, file names, citation titles, OpenAI or local message IDs, feedback handles or tokens. Analytics that needs the content belongs on the server, in the app's own code.

### Script tag: `askdare('on', type, listener)`

- `type` is an event type, or `'*'` for all of them. The call returns a function that removes the listener. `askdare('off', type, listener)` does the same and also works through the stub, before the script has loaded.
- The iframe sends events over the existing MessagePort (`{ v: 1, type: 'event', event }`). The loader checks each one again: a known type, only that type's fields, and each value a finite number, a boolean, `null` or a short lowercase code. It sets `bot` itself and freezes the event.
- The loader emits `open` and `close` itself.

### React: `<Root onEvent>`

- `Root` takes `onEvent`. It always calls the latest function, so passing a new one on every render doesn't restart the chat.
- The types `ChatEvent`, `ChatEventType` and `ChatEventListener` are exported from `@boldare/askdare/react`.

### Listeners never break the chat

The store and the loader share one small emitter. It freezes each event, so one listener can't change what the next one gets. A listener that throws is logged in one line that names the event type, with no details, and the other listeners still run.

## Consequences

- **New public API (ADR-0006):**
  - `askdare('on')` and `askdare('off')`;
  - `Root`'s `onEvent` and the event types;
  - the catalog itself: type names, field names and value sets.
- **Versioning:**
  - a new type, a new field or a new value is additive and comes in a minor release;
  - removing or renaming any of them follows the deprecation rule.
- **Loader size:** the loader grows by a few hundred bytes and stays under its 5 KB budget.
- **What the page can't do:** react to the content of an answer, such as opening a product page the bot mentioned. That needs a tool on the server, or a later, deliberate opt-in ADR.

## Alternatives considered

- **A `CustomEvent` on `window`**, so GTM could listen without code. It's a second API for the same thing, and any script on the page could dispatch fake ones. We can add it later as sugar over `on`.
- **Events with the message text, behind a bot option.** It's the most requested shape, but it hands content to every analytics script on the page. Rejected for now, per ADR-0004.
- **Forwarding protocol events (`text.delta`, …) to the page.** That exposes the wire protocol and its content, and ties the page to its version.
- **Diffing `useChatState` in React.** It works without a new API, but it's fragile and React-only.
