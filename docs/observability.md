# Observability

Once the chat is live, you'll want to know what it costs, where a slow answer spent its time, and when something breaks. askdare keeps no database, so it hands each turn to your code instead, through two hooks of `createChatHandler`:

| Hook | Receives | For |
| --- | --- | --- |
| [`onUsage`](configuration.md#onusage) | Every turn: tokens, model, timings, tool calls, outcome | Costs, dashboards, tracing |
| [`onError`](configuration.md#onerror) | Server errors and errors that end an answer | Error monitoring, such as Sentry |

Both may be async. askdare calls them after the answer has streamed, keeps the function alive until they finish, and logs anything they throw by its error's name, so a broken hook never breaks the chat. Neither receives message text: reports carry counters and pseudonyms.

Visitors' ratings of answers reach a third hook, `onFeedback`: see [Answer ratings](feedback.md).

For analytics on the page itself, such as GA4 or a GTM `dataLayer`, listen to the chat's [events in the browser](#events-in-the-browser).

## Costs per turn

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onUsage: async ({ bot, model, usage, outcome }) => {
    await metrics.increment('chat.turns', { bot, model, outcome });
    await metrics.increment('chat.input_tokens', usage.inputTokens, { bot, model });
    await metrics.increment('chat.output_tokens', usage.outputTokens, { bot, model });
  },
});
```

Multiply the counters by your model's prices to get money. Cached input is part of the input and usually costs less; reasoning tokens are part of the output. `conversation` is a pseudonym that stays the same for every turn of a conversation, so you can sum a conversation's cost without knowing whose it was. [Costs](costs.md) explains what drives them.

## Tracing with OpenTelemetry

`@boldare/askdare-otel` turns each report into OpenTelemetry spans, with the attributes of the [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai):

```bash
npm install @boldare/askdare-otel @opentelemetry/api
```

```ts
import { otelUsage } from '@boldare/askdare-otel';

export const { GET, POST, DELETE } = createChatHandler({ bots, onUsage: otelUsage() });
```

Each turn becomes a `chat <model>` span with the token counts, the finish reason and the conversation's pseudonym. Each tool call becomes an `execute_tool <name>` span inside it, marked as an error when it failed or timed out. A turn with several model calls (rounds of tool calls) is one `chat` span with their usage summed.

The spans go to whatever tracer provider your app registers. In Next.js that is `instrumentation.ts`, for example with `@vercel/otel`:

```ts
// instrumentation.ts
import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({ serviceName: 'my-site' });
}
```

Pass `otelUsage({ tracer })` to record with a tracer of your own.

The spans are recorded after the turn ends, with its real start and end times, in whatever trace context is active then. With Next.js instrumentation that is the request's trace; otherwise each turn starts a trace of its own.

The GenAI conventions are still in development. When they rename an attribute, `@boldare/askdare-otel` follows in a minor release and says so in its changelog.

## What the reports contain

The full list is in [Configuration](configuration.md#onusage). In short:

- **Counted:** input, cached input, cache-write input, output and reasoning tokens; model calls; tool calls with their durations and outcomes.
- **Identified by pseudonyms:** the conversation and the visitor (or the signed-in user), as HMACs that change when `CHAT_SECRET` rotates.
- **Never included:** message text, tool arguments or results, file names, IP addresses, raw conversation or visitor IDs.

A turn that breaks off mid-answer reports the usage askdare received, which can be a little less than OpenAI bills.

## Events in the browser

The page can hear what happens in the chat: when it opens, when a message is sent, when an answer arrives, when a visitor rates an answer ([ADR-0013](adr/0013-browser-events.md)). With the script tag:

```html
<script>
  window.askdare = window.askdare || function () { (askdare.q = askdare.q || []).push(arguments) };
  askdare('on', '*', function (event) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'askdare.' + event.type, askdare: event });
  });
</script>
```

`askdare('on', type, listener)` takes one event type or `'*'` for all, and returns a function that removes the listener. Through the stub, before the script has loaded, nothing is returned: remove it with `askdare('off', type, listener)`.

In a chat inside your page, pass `onEvent` to [`Root`](react.md#root):

```tsx
<Root config={config} onEvent={(event) => track(`chat_${event.type}`, event)}>
```

Every event has `type` and `bot`:

| `type` | Other fields | When |
| --- | --- | --- |
| `ready` | | Once, when the chat can take messages. Not if loading the stored conversation fails. |
| `open`, `close` | | The panel opened or closed. Script tag only. |
| `message.sent` | `length` (characters), `attachments`, `source`: `typed` or `starter` | The visitor sent a message |
| `message.received` | `outcome`: `completed`, `failed`, or `stopped` when a `Root` unmounts mid-answer; `durationMs`; `citations` | An answer ended. Closing the widget doesn't stop an answer, so this still comes. |
| `feedback` | `rating`: `up`, `down` or `null`; `commented` | The server took a rating. A 👎 with a comment fires twice. |
| `error` | `code` | A turn failed |
| `conversation.reset` | | The visitor started over |

Events carry metadata only: never the text of messages or comments, file names, sources, IDs or tokens, because analytics scripts on your page are often third parties. New types and fields may come in a minor release, so ignore the ones you don't know. A listener that throws is logged in one line, and the chat goes on.
