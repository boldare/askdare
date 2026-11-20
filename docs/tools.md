# Tools

Tools are server-side functions the model may call during a conversation: look up an order, check a price, fetch the weather. You describe the arguments with a Zod schema; askdare validates every call before your code runs.

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
    const order = (await response.json()) as { status: string };
    return { orderNumber, status: order.status };
  },
});
```

```ts
// askdare.config.ts
defineBot({
  // …
  tools: [orderStatus],
});
```

## How a call works

1. The model decides to call a tool and proposes arguments.
2. askdare validates them with your schema. Invalid arguments go back to the model as an error, and `execute` doesn't run.
3. `execute` runs on your server, with a timeout (`timeoutMs`, 10 seconds by default). Several calls in one step run in parallel.
4. Whatever `execute` returns goes back to the model as JSON. Return `{ error: '…' }` for failures the model should explain; a thrown error reaches the model as a generic failure.
5. The visitor sees only a short status ("Using get_order_status…"), never the arguments or the result.

A bot makes at most `limits.maxSteps` model calls per message (default 5); the last one must answer in words.

## Reply options

A tool can turn its result into options the visitor clicks instead of typing, shown as buttons under the answer. You decide them in code, so they are the same every time the result is:

```ts
export const orderStatus = defineTool({
  name: 'get_order_status',
  // … description, input and execute as above
  replies: (order) =>
    order.status === 'shipped'
      ? ['Track the parcel', 'Cancel the order', 'Talk to a person']
      : undefined,
});
```

- `replies` gets the result of a successful call, typed from `execute`. It's the result as the model received it, parsed back from JSON (a `Date` is a string by then), so the options come back the same after a reload. A call that failed, timed out or returned too much data defines none.
- A click sends the option's text as the visitor's own message, exactly as if they had typed it. It doesn't run the tool or anything else by itself: the model reads the message and decides, as always. So write options the visitor would say ("Track the parcel"), not commands.
- The model never sees the options, and the visitor never sees the result: only the options reach the browser.
- askdare keeps at most 4 options of up to 80 characters, one line of plain text each, and drops the rest: empty, repeated or too long ones, any with invisible characters, and any that contain a link or something that looks like one (`example.com`). Return `undefined` or `[]` to offer none. If `replies` throws, the answer comes without options and the error is logged.
- Only the latest answer shows options, and they disappear once the visitor sends anything. When several calls in one answer define options, the last call's win.

[Reply options](reply-options.md) has more flows, options in several languages, and when to let the model suggest options instead.

## Cards for the visitor

A tool can also pick what the visitor may see of its result, for a card, a list or a table that your own React component draws under the answer ([ADR-0017](adr/0017-tool-renderers.md)):

```ts
export const findSlots = defineTool({
  name: 'find_slots',
  description: 'Free consultation slots on a day.',
  input: z.object({ day: z.string() }),
  execute: async ({ day }) => calendar.freeSlots(day),
  ui: (result) => ({ day: result.day, slots: result.slots.map((slot) => slot.start) }),
});
```

- **Only what `ui` returns reaches the browser,** never the result itself. Pick the fields a visitor may see: no internal IDs, costs or notes, nothing about other customers. The visitor can read the payload in their browser even where no component shows it.
- **Keep `ui` pure.** It gets the result as the model received it, parsed back from JSON (a `Date` is a string by then), and runs again on every reload to bring the card back. The same result must give the same payload; a reload after a deploy shows what your current `ui` returns.
- **Limits.** Return plain JSON of at most 8 KB and 8 levels of arrays and objects, or `undefined` or `null` for no card. A payload over a limit is dropped whole and the tool's name is logged. An answer shows at most 4, in call order. A call that failed, timed out or returned too much data shows none. If `ui` throws, the answer comes without that card and the error is logged.
- **The model still sees the whole result** and writes about it as usual. If the card should speak for itself, say so in the tool's description or the bot's instructions.
- **Drawing the card** is your React component, registered with `Root`'s `toolRenderers` in the chat inside your page ([Tool cards](react.md#tool-cards)). The payload's type comes from `ui`, and the tool's name stays a literal, so a page types its components from the tool with `import type`. In the script-tag widget, a bot draws them when its iframe shows your own page (`embedPath`, [Embedding](embedding.md#your-own-page-in-the-iframe)); askdare's own iframe page has no components to draw them with.

## Rules

- **Every field is required.** OpenAI's strict mode demands it: use `.nullable()` instead of `.optional()`. `defineTool` fails at startup otherwise.
- **Describe well.** The model picks tools by `description` and fills fields by their `.describe()`.
- **Never trust the model with identity.** The model can be talked into anything, so a tool must not take user IDs, emails or permissions from its arguments. The second argument of `execute` holds what askdare verified: `botId`, `visitorId` (pseudonymous, created by the server), `locale`, `identity` (the signed-in user, when your site [identifies](identity.md) them) and an abort `signal`.
- **Read-only, for now.** Tools that change data (place an order, send an email) need the visitor's confirmation, which askdare doesn't offer yet. Keep tools to lookups.
- **Keep results small.** Return the fields the model needs. Large results cost input tokens on every later message.
- **Keep it under about 20 tools per bot.** More tools make the model slower and less accurate.
- **Reserved names.** `file_search` (the knowledge base) and `suggest_replies` (reply options, `widget.replies: 'suggest'`) are built in; `defineBot` refuses a tool with either name. `suggest_replies` runs none of your code and shows no status to the visitor.

The demo site has two working examples in [`site/tools.ts`](../site/tools.ts).
