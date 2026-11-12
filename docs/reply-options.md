# Reply options

Reply options are a few buttons under the bot's latest answer, such as "Track the parcel" or "Talk to a person". The visitor clicks one instead of typing. They help most when the next step is obvious but tedious to type: answering a question the bot just asked, picking from a short list, or asking the usual follow-up ([ADR-0015](adr/0015-reply-options.md)).

```text
Bot:  Your order 104233 shipped yesterday with DHL.
      It should arrive on Thursday.

      [ Track the parcel ]  [ Talk to a person ]
```

- **Only the latest answer has options.** They disappear as soon as the visitor sends anything, typed or clicked.
- **A click sends the option's text as the visitor's message,** exactly as if they had typed it. Their message in the chat is that text.
- **They come back after a reload,** as long as the visitor hasn't written since.

## Pick a source

Options come from the model or from your tools. A bot can use both.

| | The model suggests them | A tool defines them |
| --- | --- | --- |
| Turn on | `widget.replies: 'suggest'` on the bot | `replies` in `defineTool` |
| Who writes them | The model, from the conversation | Your code, from the tool's result |
| Good for | Follow-up questions, answers to a question the bot asked, any topic | Fixed next steps of a known flow: an order, a booking, a plan |
| Same every time | No: the model decides whether and what to suggest | Yes: the same result gives the same options |
| Language | The answer's | Whatever your code returns ([see below](#options-in-the-visitors-language)) |
| Cost | More input tokens, and sometimes one more model call ([Cost](#cost)) | None: your code runs on the server after the tool |

**Tool options win.** When a tool defines options during an answer, the model isn't offered `suggest_replies` again in that answer, and a suggestion it made earlier in the same answer is dropped. When several tool calls define options, the last call's win.

## Let the model suggest them

Turn it on per bot:

```ts
// askdare.config.ts
defineBot({
  id: 'support',
  // …
  widget: {
    replies: 'suggest',
  },
});
```

The model gets a built-in tool, `suggest_replies`, whose description tells it to offer 2 to 4 short replies when a few clear next steps would help, and to skip them for greetings and small talk. The server answers the call itself; none of your code runs, and the visitor sees no tool status.

Models often leave the options out, even after asking the visitor to choose. Say when you want them in your instructions:

```ts
defineBot({
  id: 'support',
  instructions: ({ locale }) =>
    `You answer questions about Brightloop's plans and support. Reply in ${locale}. ` +
    'After an answer about Brightloop, suggest replies: the likely answers when you asked ' +
    'the visitor something, otherwise the follow-up questions they would most likely ask next.',
  widget: { replies: 'suggest' },
});
```

After "Which plan are you on?", the visitor might see `Free`, `Team`, `Enterprise`; after an answer about pricing, `Is there a yearly discount?`, `How do I upgrade?`.

The model can't suggest options on the last model call of a message, because that call must answer in words. A bot with `limits.maxSteps: 1` therefore never shows suggested options.

## Define them in a tool

Give `defineTool` a `replies` function. It receives the tool's result and returns the options, or `undefined` for none ([Tools](tools.md#reply-options)).

### Example: an order-status flow

```ts
// tools.ts
import { defineTool } from '@boldare/askdare';
import { z } from 'zod';

export const orderStatus = defineTool({
  name: 'get_order_status',
  description: 'Status of an order by its number. Use it when the visitor asks about an order.',
  input: z.object({
    orderNumber: z.string().regex(/^\d{6}$/).describe('Six-digit order number'),
  }),
  execute: async ({ orderNumber }, { signal }) => {
    const response = await fetch(`https://shop.example.com/api/orders/${orderNumber}`, { signal });
    if (!response.ok) return { error: 'No such order.' };
    const order = (await response.json()) as { status: 'processing' | 'shipped' | 'delivered' };
    return { orderNumber, status: order.status };
  },
  replies: (order) => {
    if ('error' in order) return ['Try another order number', 'Talk to a person'];
    switch (order.status) {
      case 'processing':
        return ['Change the delivery address', 'Cancel the order', 'Talk to a person'];
      case 'shipped':
        return ['Track the parcel', 'Talk to a person'];
      case 'delivered':
        return ['Return an item', 'Something is missing'];
    }
  },
});
```

The visitor asks "Where is my order 104233?", the model calls the tool and writes the answer, and the options under it match the order's state. A click on "Track the parcel" sends that text; the model reads it and answers, for example by calling a tracking tool. Each option must be something your bot can actually handle: instructions, a knowledge base or another tool that covers it.

### Example: picking a time slot

```ts
export const freeSlots = defineTool({
  name: 'find_free_slots',
  description: 'Free consultation slots in the next 7 days. Use it before suggesting a time.',
  input: z.object({ topic: z.enum(['sales', 'support']) }),
  execute: async ({ topic }, { signal }) => {
    const slots = await calendar.freeSlots(topic, { days: 7, signal }); // your calendar's API
    return { topic, slots: slots.slice(0, 3).map((slot) => slot.label) }; // "Tue 14 Nov, 10:00"
  },
  replies: ({ slots }) => (slots.length > 0 ? [...slots, 'None of these work'] : undefined),
});
```

Three slots and a way out fit the limit of four. The visitor clicks "Tue 14 Nov, 10:00", and the model gets that as their message.

**An option is not a confirmation.** "Yes, book it" arrives as a message the visitor could also have typed, and the model, not your code, decides what happens next. Tools are [read-only for now](tools.md#rules): don't build a write action on the assumption that a click confirmed it.

### Options in the visitor's language

`replies` gets only the result. If your bot speaks several languages, put the visitor's language into the result in `execute` and pick the labels from it:

```ts
const LABELS = {
  en: { track: 'Track the parcel', human: 'Talk to a person' },
  pl: { track: 'Śledź paczkę', human: 'Porozmawiaj z człowiekiem' },
};

export const orderStatus = defineTool({
  // … name, description and input as above
  execute: async ({ orderNumber }, { locale, signal }) => {
    // … fetch the order
    return { orderNumber, status: order.status, lang: locale.startsWith('pl') ? 'pl' : 'en' };
  },
  replies: ({ lang, status }) => {
    const t = LABELS[lang];
    return status === 'shipped' ? [t.track, t.human] : [t.human];
  },
});
```

Options are stored with the conversation as the result was, so they come back in the language they were shown in. Suggested options follow the answer's language on their own.

## Limits and safety

The server cleans every option, from the model and from tools alike, and the chat checks them again:

- **At most 4 options, each at most 80 characters,** trimmed and on one line. Extra, empty and repeated ones are dropped.
- **Only what the visitor can read.** An option with invisible characters (zero-width or tag characters, direction marks, private-use code points) is dropped, because a click sends exactly that text as the visitor's message.
- **No links.** An option with a URL, `www.`, an IP address or anything that looks like a domain (`example.com`) is dropped. Put links in the answer, where the chat renders them safely.
- **Plain text.** Options are never rendered as Markdown or HTML, so `**bold**` shows as typed.
- **If nothing is left, no options show.** If your `replies` function throws, the answer comes without options and the error is logged.

**A click is only a message.** It doesn't run a tool, choose a flow or carry an ID: the server can't tell it from typed text, and it goes through the same limits and budgets ([ADR-0004](adr/0004-threat-model.md)). So write options the way the visitor would say them ("Cancel the order"), not as commands ("cancel_order"). An option the model was tricked into suggesting, for example by a document in the knowledge base, is at worst text the visitor chooses to send, which they could also have typed.

## Placement and styling

The theme's `replies` variant puts the options under the answer (`answer`, the default) or in one row above the message field that scrolls sideways (`composer`):

```ts
import { defineTheme } from '@boldare/askdare';

const brand = defineTheme({ extends: 'aura', variants: { replies: 'composer' } });

defineBot({ /* … */ widget: { theme: brand, replies: 'suggest' } });
```

Style them with the parts `replies` (the group) and `reply` (each button). The group has `data-placement="composer"` above the message field ([Styling](styling.md#2-your-own-css)):

```css
[data-ask-part="reply"] {
  border-radius: 999px;
  font-weight: 600;
}
[data-ask-part="replies"][data-placement="composer"] {
  padding-block: 4px;
}
```

The group's accessible name is the text `message.replies` ("Suggested replies"), which you can change like any [text](texts.md).

## In React

`DefaultChat` shows options as the widget does. With your own markup, render `QuickReplies` ([React](react.md#your-own-markup)). Inside a message it shows the options under the latest answer only; outside `MessageList` it shows the latest answer's options wherever you put it:

```tsx
'use client';
import * as Chat from '@boldare/askdare/react';

export function SupportChat({ config }: { config: Chat.ChatConfig }) {
  return (
    <Chat.Root config={config}>
      <Chat.Panel className="support-chat">
        <Chat.Messages>
          <Chat.MessageList>
            <Chat.Message>
              <Chat.MessageText />
            </Chat.Message>
          </Chat.MessageList>
        </Chat.Messages>
        <Chat.QuickReplies className="support-replies" />
        <Chat.Composer>
          <Chat.Input />
          <Chat.Send>Send</Chat.Send>
        </Chat.Composer>
      </Chat.Panel>
    </Chat.Root>
  );
}
```

The buttons are disabled while an answer streams. To build the buttons yourself, read `replies` of the latest message in `state.messages` from `useChat()`, and send one with `actions.send(text)`.

## Measure clicks

A clicked option fires `message.sent` with `source: 'reply'` ([Chat events](events.md)). The event says that an option was clicked, not which one: events never carry text.

```js
askdare('on', 'message.sent', function (event) {
  gtag('event', 'chat_message_sent', { chat_bot: event.bot, chat_source: event.source });
});
```

Compare the share of `reply` with `typed` to see whether visitors use the options. askdare doesn't report which option was picked: neither events nor the server hooks carry message text ([Observability](observability.md#what-the-reports-contain)). For tool-defined options, the tools a click leads to tell you a lot: count them by `name` in the `tools` of [`onUsage`](configuration.md#onusage), such as the tracking tool after "Track the parcel".

## Cost

- **Tool-defined options cost nothing extra.** Your function runs on the server after the tool, and the model never sees the options.
- **Suggested options cost tokens.** The definition of `suggest_replies` (about 250 tokens) is input on every model call, mostly cached. When the model suggests options before it answers, the message takes one more model call. [Costs](costs.md#reply-options) explains both and how to measure them with `onUsage`.

## Troubleshooting

- **No options with `replies: 'suggest'`.** The model decided none would help. Say when you want them in the instructions, as [above](#let-the-model-suggest-them). Check that `limits.maxSteps` is above 1 and that the daily budgets aren't nearly used up: when the extra call doesn't fit, the model answers without options.
- **A tool's options don't show.** The call failed, timed out or returned too much data, `replies` returned `undefined` or threw (see the server log), or every option broke a limit: too long, repeated, or with a link.
- **The model lists the options in its answer as well.** askdare already tells it not to; if it still does, say in the instructions that the visitor sees the options as buttons.
- **Options from an earlier answer are gone.** That's by design: only the latest answer has them.
