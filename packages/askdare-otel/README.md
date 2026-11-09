# @boldare/askdare-otel

OpenTelemetry spans for every chat turn of [`@boldare/askdare`](https://www.npmjs.com/package/@boldare/askdare), with the attributes of the [GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai).

**[askdare website and docs](https://askdare.vercel.app)** · [Observability guide](https://askdare.vercel.app/docs/observability) · [GitHub](https://github.com/boldare/askdare/tree/main/packages/askdare-otel)

## Install

```bash
npm install @boldare/askdare-otel @opentelemetry/api
```

## Use

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { otelUsage } from '@boldare/askdare-otel';
import { bots } from '../../../../askdare.config';

export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({ bots, onUsage: otelUsage() });
```

The spans go to the tracer provider your app registers, for example in `instrumentation.ts` with `@vercel/otel`. Pass `otelUsage({ tracer })` to use a tracer of your own.

## What it records

| Span | Kind | Attributes |
| --- | --- | --- |
| `chat <model>`, one per turn | `CLIENT` | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.conversation.id` (a pseudonym), `gen_ai.usage.*` tokens, `gen_ai.response.finish_reasons`, `error.type`, and `askdare.bot`, `askdare.visitor` (a pseudonym), `askdare.outcome`, `askdare.steps` |
| `execute_tool <name>`, one per tool call, inside the turn | `INTERNAL` | `gen_ai.operation.name`, `gen_ai.tool.name`, `gen_ai.tool.type`, `gen_ai.conversation.id`, `error.type` |

Spans are recorded once the turn has ended, with its real times. They never contain message text, tool arguments or results. The GenAI conventions are still in development; when they rename an attribute, this package follows in a minor release.

## Requirements

`@boldare/askdare` of the same minor version, `@opentelemetry/api` 1.3 or later, and Node.js 22 or later.

## License

MIT © Boldare
