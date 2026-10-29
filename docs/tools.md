# Tools

Tools are server-side functions the model may call during a conversation: look up an order, check a price, fetch the weather. You describe the arguments with a Zod schema; chatdock validates every call before your code runs.

```ts
// tools.ts
import { defineTool } from '@boldare/chatdock';
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
// chatdock.config.ts
defineBot({
  // …
  tools: [orderStatus],
});
```

## How a call works

1. The model decides to call a tool and proposes arguments.
2. chatdock validates them with your schema. Invalid arguments go back to the model as an error, and `execute` doesn't run.
3. `execute` runs on your server, with a timeout (`timeoutMs`, 10 seconds by default). Several calls in one step run in parallel.
4. Whatever `execute` returns goes back to the model as JSON. Return `{ error: '…' }` for failures the model should explain; a thrown error reaches the model as a generic failure.
5. The visitor sees only a short status ("Using get_order_status…"), never the arguments or the result.

A bot makes at most `limits.maxSteps` model calls per message (default 5); the last one must answer in words.

## Rules

- **Every field is required.** OpenAI's strict mode demands it: use `.nullable()` instead of `.optional()`. `defineTool` fails at startup otherwise.
- **Describe well.** The model picks tools by `description` and fills fields by their `.describe()`.
- **Never trust the model with identity.** The model can be talked into anything, so a tool must not take user IDs, emails or permissions from its arguments. The second argument of `execute` holds what chatdock verified: `botId`, `visitorId` (pseudonymous, created by the server), `locale` and an abort `signal`.
- **Read-only, for now.** Tools that change data (place an order, send an email) need the visitor's confirmation, which chatdock doesn't offer yet. Keep tools to lookups.
- **Keep results small.** Return the fields the model needs. Large results cost input tokens on every later message.
- **Keep it under about 20 tools per bot.** More tools make the model slower and less accurate.

The starter has two working examples in [`examples/starter/tools.ts`](../examples/starter/tools.ts).
