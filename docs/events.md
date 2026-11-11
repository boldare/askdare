# Chat events

Your page can hear what happens in the chat: when it opens, when a visitor sends a message, when an answer arrives, when an answer is rated. Use these events for analytics such as GA4 or a GTM `dataLayer`, or to make your page react, for example by hiding your own "Contact us" button while the chat is open ([ADR-0013](adr/0013-browser-events.md)).

Events carry metadata only: counts, durations, outcomes and ratings. They never carry what anyone wrote. To work with the conversations themselves, use the server hooks in [Observability](observability.md) and [Answer ratings](feedback.md).

## With the script tag

Register a listener with `askdare('on', type, listener)`. Pass one event type, or `'*'` for all of them:

```html
<script>
  // Safe before the script has loaded: calls queue up and run once it is ready.
  window.askdare = window.askdare || function () {
    (window.askdare.q = window.askdare.q || []).push(arguments);
  };
  askdare('on', '*', function (event) {
    console.log('askdare', event.type, event);
  });
</script>
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

Register before the script loads, as above, and you hear `ready` too. A listener added later still hears everything after that.

`askdare('on')` returns a function that removes the listener. Through the queue, before the script has loaded, it returns nothing, so keep the listener and remove it with `askdare('off')`:

```js
function onSent(event) { /* … */ }
askdare('on', 'message.sent', onSent);
// later
askdare('off', 'message.sent', onSent);
```

## In React

In a chat inside your page ([React](react.md)), pass `onEvent` to `Root`:

```tsx
'use client';
import * as Chat from '@boldare/askdare/react';

export function SupportChat({ config }: { config: Chat.ChatConfig }) {
  return (
    <Chat.Root config={config} onEvent={(event) => track(`chat_${event.type}`, event)}>
      <Chat.DefaultChat />
    </Chat.Root>
  );
}
```

- **`Root` always calls the latest function.** An inline arrow function is fine: a new one on each render doesn't restart the chat.
- **The types are exported:** `ChatEvent`, a union you can narrow by `event.type`, along with `ChatEventType` and `ChatEventListener`.
- **There are no `open` or `close` events in React.** The chat is part of your page, so you already know when you show it.

## The events

Every event has `type` and `bot`, the bot's ID. The other fields depend on the type:

| `type` | Other fields | When |
| --- | --- | --- |
| `ready` | | Once per chat, when it can take messages: the visitor is known and the stored conversation, if any, has loaded. Not if loading it fails. |
| `open` | | The panel opened. Script tag only, and not for an inline chat, which is always open. |
| `close` | | The panel closed. Script tag only. |
| `message.sent` | `length`, `attachments`, `source` | The visitor sent a message. |
| `message.received` | `outcome`, `durationMs`, `citations` | An answer ended. |
| `feedback` | `rating`, `commented` | The server accepted a rating. |
| `error` | `code` | A turn failed. |
| `conversation.reset` | | The visitor started a new conversation. |

| Field | Type | Meaning |
| --- | --- | --- |
| `length` | number | The message's length in characters. |
| `attachments` | number | How many images and PDFs it carried. |
| `source` | `'typed'` or `'starter'` | Typed or dictated into the field, or picked from the suggested questions. |
| `outcome` | `'completed'`, `'failed'` or `'stopped'` | `stopped` when the chat was taken down mid-answer, as when a React `Root` unmounts. |
| `durationMs` | number | From sending the message to the end of the answer. |
| `citations` | number | How many sources the answer cites. |
| `rating` | `'up'`, `'down'` or `null` | `null` when the visitor took their rating back. |
| `commented` | boolean | A 👎 came with a comment. |
| `code` | string | One of the [error codes](troubleshooting.md#error-codes), such as `rate_limited` or `timeout`. |

### Good to know

- **Events come in order for each message.** A `message.sent` is followed by exactly one `message.received`, with an `error` just before it when the turn failed.
- **Closing the panel doesn't stop an answer.** The answer finishes in the background, so `message.received` still arrives after `close`.
- **A 👎 with a comment fires `feedback` twice:** first for the 👎 (`commented: false`), then once the comment is sent (`commented: true`).
- **A rating the server refuses fires nothing,** because the chat takes it back.
- **New types and fields may come in a minor release.** Ignore the ones you don't know, and handle the ones you do by `event.type`.

## What events never contain

Analytics scripts on your page are often third parties, so events leave out:
- the text of messages, answers and comments;
- page context, file names, source titles and links;
- conversation, message and OpenAI IDs, feedback handles and tokens;
- anything about who the visitor is.

With the script tag the loader checks this again on your page. It passes on only the known types and fields, each a number, a boolean, `null` or a short code, and it sets `bot` itself. Each event is frozen, so one listener can't change what the next one gets.

A listener that throws doesn't break the chat. askdare logs one line naming the event type, without the error, and the other listeners still run.

## Examples

### Google Analytics 4

```js
askdare('on', '*', function (event) {
  const { type, bot, ...params } = event;
  gtag('event', 'chat_' + type.replace('.', '_'), { chat_bot: bot, ...params });
});
```

GA4 event names allow only letters, digits and underscores, hence `chat_message_sent` rather than `chat_message.sent`.

### Google Tag Manager

```js
askdare('on', '*', function (event) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'askdare.' + event.type, askdare: event });
});
```

In GTM, add a Custom Event trigger on `askdare.message.sent` (or a regex such as `^askdare\.`) and read the fields with Data Layer Variables, such as `askdare.length`.

### Hide your own button while the chat is open

```js
const contact = document.getElementById('contact-us');
askdare('on', 'open', () => { contact.hidden = true; });
askdare('on', 'close', () => { contact.hidden = false; });
```

### Count questions until a conversion

```js
let asked = 0;
askdare('on', 'message.sent', () => { asked += 1; });
document.querySelector('#signup').addEventListener('submit', () => {
  gtag('event', 'sign_up', { chat_questions: asked });
});
```

## Types for the script tag

The script tag adds `window.askdare` at runtime and ships no types. In a TypeScript page, declare what you use:

```ts
type AskdareEvent = { type: string; bot: string } & Record<string, string | number | boolean | null>;

declare global {
  interface Window {
    askdare: {
      (command: 'on', type: string, listener: (event: AskdareEvent) => void): (() => void) | undefined;
      (command: 'off', type: string, listener: (event: AskdareEvent) => void): void;
      (command: 'open' | 'close' | 'toggle'): void;
    };
  }
}
export {};
```

In React, use `ChatEvent` from `@boldare/askdare/react` instead.

## Try it in the browser

Open a page with the chat and its DevTools console. Choose **top** in the console's context menu rather than the chat's frame: `askdare` lives on your page, not in the chat. Then paste:

```js
const off = askdare('on', '*', (event) => console.log('[askdare]', event.type, event));
```

Open the chat, ask something, rate the answer, start over and close it. The console shows each event as it happens. `off()` stops it. You only see `ready` if you add the listener before the first open, because the chat loads when it first opens.

## Troubleshooting

- **`askdare is not defined`.** The console is in the chat's frame, or the page hasn't defined the queue and the script hasn't loaded yet. Switch the console to **top**, or define the queue as in [the first example](#with-the-script-tag).
- **No `ready`.** The listener came after the chat had loaded, or loading the stored conversation failed. The chat then shows why.
- **Nothing at all.** Check that the page runs a version of askdare with events: the loader comes from your app (`/api/chat/widget.js`), so redeploy the app after upgrading.
- **`[askdare] A listener for "…" threw.`** One of your listeners threw. The chat carries on, but that listener missed the event.
