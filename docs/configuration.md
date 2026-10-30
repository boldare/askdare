# Configuration reference

You configure askdare in two places:

| Where | What | Import |
| --- | --- | --- |
| `askdare.config.ts` | One `defineBot({ … })` per bot: its model, instructions, features, limits and look. | `@boldare/askdare` |
| `app/api/chat/[...path]/route.ts` | One `createChatHandler({ … })` for all bots: secrets, the counter store, the client IP and error reporting. | `@boldare/askdare/next` |

`defineBot` checks the whole definition when your app starts. It throws a `TypeError` that lists every problem, for example:

```text
[askdare] Invalid bot "Support": id use 1-48 lowercase letters, digits or dashes.
```

`createChatHandler` checks its own options when the route loads. It reads secrets on the first request, so `next build` never needs them.

## Example

```ts
// askdare.config.ts
import { defineBot } from '@boldare/askdare';
import { orderStatus } from './tools';

// Other sites that may embed the chat, comma-separated.
const allowedOrigins = (process.env.ASKDARE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const bots = [
  defineBot({
    id: 'support',
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: ({ locale }) =>
      `You are the assistant on our website. Answer briefly. Reply in the visitor's language; default to ${locale}.`,
    tools: [orderStatus],
    knowledge: process.env.KB_VECTOR_STORE_ID
      ? { vectorStoreId: process.env.KB_VECTOR_STORE_ID }
      : undefined,
    attachments: { pdf: false },
    voice: process.env.ASKDARE_TRANSCRIBE_MODEL
      ? { model: process.env.ASKDARE_TRANSCRIBE_MODEL }
      : undefined,
    security: { allowedOrigins },
    limits: { dailyTokens: 500_000, messagesPerVisitorPerMinute: 5 },
    widget: {
      title: 'Support',
      locale: 'auto',
      starters: ['Where is my order?'],
      disclosure: { privacyUrl: '/privacy' },
      theme: 'aura',
    },
  }),
];
```

```ts
// app/api/chat/[...path]/route.ts
import { createChatHandler } from '@boldare/askdare/next';
import { upstashStore } from '@boldare/askdare-upstash';
import { bots } from '@/askdare.config';

// Must be a literal in this file; keep it above every bot's limits.turnTimeoutMs.
export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  limits: { store: upstashStore(), globalDailyTokens: 1_000_000 },
});
```

## `defineBot`

`defineBot(definition: BotDefinition): Bot`. The types of every field are exported from `@boldare/askdare`: `BotDefinition`, `BotContext`, `BotLimits`, `BotSecurity`, `KnowledgeConfig`, `AttachmentConfig`, `VoiceConfig` and `WidgetConfig`.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `id` | `string` | required | 1–48 lowercase letters, digits or dashes, starting with a letter or digit. Used in the script tag (`widget.js?bot=<id>`) and in routes. Unique within a handler. |
| `model` | `string` | required | An OpenAI model ID, not empty. askdare never picks a model for you. |
| `instructions` | `string \| (context: BotContext) => string` | required | A non-empty string, or a function. See [Instructions](#instructions). |
| `tools` | `Tool[]` | `[]` | Created with `defineTool`. At most 64, with unique names. The name `file_search` is reserved. Keep it under about 20. See [Tools](tools.md). |
| `pageContext` | `boolean` | `false` | Accepts a page description from `askdare('configure', { context })` and passes it to the model with the visitor's message. Anyone can set it, so it gets no more trust than what visitors type. See [Styling](styling.md#3-page-javascript). |
| `knowledge` | `KnowledgeConfig` | off | Documents the model searches and cites. See [Knowledge](#knowledge). |
| `attachments` | `AttachmentConfig` | off | Images and PDFs from visitors. See [Attachments](#attachments). |
| `voice` | `VoiceConfig` | off | Dictation. See [Voice](#voice). |
| `security` | `BotSecurity` | own origin only | Sites that may embed the chat. See [Security](#security). |
| `limits` | `BotLimits` | see [Limits](#limits) | Rates and budgets. |
| `widget` | `WidgetConfig` | see [Widget](#widget) | Texts, language and look. |

### Instructions

`instructions` is a string or a function. The function runs for each request and receives a `BotContext`:

| Field | Type | Meaning |
| --- | --- | --- |
| `locale` | `string` | The validated BCP 47 tag the widget chose. |
| `identity` | `VisitorIdentity \| undefined` | The signed-in visitor, verified with `IDENTITY_SECRET`. `undefined` for anonymous visitors. See [Signed-in visitors](identity.md). |

Put no secrets in instructions. Assume visitors can make the model reveal them.

### Knowledge

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `vectorStoreId` | `string` | required | A vector store ID: `vs_` followed by letters, digits, `_` or `-`. Usually `process.env.KB_VECTOR_STORE_ID`. |
| `maxResults` | `number` | `5` | Whole number, 1–50. Chunks the model reads per search. More costs more input tokens. |

Fill the store with `npx @boldare/askdare kb sync`. See [Knowledge base](knowledge-base.md).

### Attachments

Absent, attachments are off. `attachments: {}` turns them on with the defaults.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `images` | `boolean` | `true` | PNG, JPEG, WebP and GIF. |
| `pdf` | `boolean` | `true` | PDF documents. |
| `maxBytes` | `number` | `4_000_000` | Largest file in bytes, 1,000–20,000,000. The default fits Vercel's 4.5 MB request limit. |
| `maxPerMessage` | `number` | `3` | Files per message, 1–10. |
| `maxPdfPages` | `number` | `50` | Longest PDF in pages, 1–500. |

`images` and `pdf` can't both be `false`. See [Attachments](attachments.md).

### Voice

Absent, dictation is off.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `model` | `string` | required | An OpenAI transcription model, not empty. askdare never picks one. |
| `maxSeconds` | `number` | `60` | Longest dictation in seconds, 5–300. Recording stops by itself at this point. |

See [Voice input](voice-input.md).

### Security

`security.allowedOrigins` lists the other sites that may embed the chat. The app's own origin is always allowed. The browser enforces the list through the `frame-ancestors` policy of the chat page ([ADR-0004](adr/0004-threat-model.md)).

Each entry must be an origin exactly as a browser writes it:

- `https://`, a host name and, only if it isn't the default, a port: `https://www.example.com`, `https://shop.example.com:8443`.
- `http://` only for `localhost`, `127.0.0.1`, `[::1]` and names that end in `.localhost`.
- No path, no trailing slash, no query and no wildcard (`*`).
- No default port (`:443`) and no capital letters.
- International domain names in their `xn--` form.

The list holds at most 50 origins. Duplicates are dropped. A wrong entry fails with "must be an https origin like https://www.example.com (no path or wildcard; http only for localhost)".

To check that a site may embed the chat, run `npx @boldare/askdare doctor --origin https://www.example.com`.

### Limits

Limits bound what visitors can cost ([ADR-0004](adr/0004-threat-model.md)). Every limit applies per bot, and every value is a whole number.

| Limit | Default | What it counts | Allowed |
| --- | --- | --- | --- |
| `maxOutputTokens` | `1024` | Tokens in one model response | 16–128,000 |
| `maxInputChars` | `4000` | Characters in one visitor message | 1–100,000 |
| `maxSteps` | `5` | Model calls per turn, tool round trips included | 1–20 |
| `turnTimeoutMs` | `120_000` | Milliseconds a whole turn may take. Keep it below the route's `maxDuration`. | 1,000–900,000 |
| `maxTurns` | `50` | Turns per conversation, before the visitor must start a new one | 1–1,000 |
| `messagesPerVisitorPerMinute` | `10` | Messages per visitor per minute | 1–1,000 |
| `messagesPerIpPerMinute` | `30` | Messages per client IP per minute, across visitors | 1–10,000 |
| `sessionsPerIpPerHour` | `30` | New sessions per client IP per hour. Renewals by returning visitors count separately. | 1–10,000 |
| `conversationsPerIpPerHour` | `20` | New conversations per client IP per hour | 1–10,000 |
| `dailyTokens` | `2_000_000` | Input plus output tokens per UTC day, across all visitors | 1,000 or more |
| `dailyTokensPerIp` | `200_000` | Input plus output tokens per client IP per UTC day | 100 or more |
| `uploadsPerVisitorPerHour` | `20` | File uploads per visitor per hour | 1–1,000 |
| `uploadsPerIpPerHour` | `60` | File uploads per client IP per hour, across visitors | 1–10,000 |
| `uploadsPerDay` | `500` | File uploads per UTC day, across all visitors | 1–1,000,000 |
| `transcriptionsPerVisitorPerHour` | `30` | Dictations per visitor per hour | 1–1,000 |
| `voiceSecondsPerDay` | `3600` | Seconds of speech transcribed per UTC day, across all visitors | 60 or more |
| `voiceSecondsPerIpPerDay` | `600` | Seconds of speech transcribed per client IP per UTC day | 60 or more |

What happens at a limit:

- **Rates** answer `rate_limited`, with a `Retry-After` header. So does `maxTurns`, which asks the visitor to start a new conversation.
- **Token budgets** answer `budget_exceeded` until midnight UTC. Before each model call, askdare reserves an estimate against `dailyTokens`, `dailyTokensPerIp` and the handler's `globalDailyTokens`. The estimate covers the conversation so far, the new message, `maxOutputTokens`, attached files and file search results. A bot with tools reserves the next call before each tool round, and answers without tools when a budget can't hold it. When the turn ends, the real usage replaces the estimate. A turn that fails or is cut off keeps the estimate charged.
- **Speech budgets** reserve `voice.maxSeconds` per dictation, then charge the duration OpenAI reports. When one is spent, dictation answers `budget_exceeded` until midnight UTC.
- **`maxInputChars`** rejects a longer message with `invalid_input`.

A few limits are fixed:

| What | Limit |
| --- | --- |
| Session renewals by a returning visitor | 12 per visitor per hour |
| History reads and deletions | 20 per visitor per minute |
| Dictations transcribing at once | 2 per client IP and 10 per bot |
| `npx @boldare/askdare doctor` runs | 3 per minute for the whole app |

Per-IP limits depend on reading the client IP correctly. See [`trustProxy`](#trustproxy).

### Widget

Everything in `widget` is sent to browsers. Never put secrets in it. [Styling](styling.md) covers texts, languages and your own CSS. [Themes](themes.md) covers presets, tokens and variants.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `title` | `string` | `'Assistant'` | 1–80 characters. Shortcut for `texts['header.title']`. |
| `subtitle` | `string` | none | 1–120 characters. Shown under the title. |
| `greeting` | `string` | `'Hi! How can I help?'` | 1–500 characters. Shortcut for `texts['welcome.greeting']`. `**words**` show in bold. |
| `placeholder` | `string` | `'Type your message…'` | 1–120 characters. Shortcut for `texts['composer.placeholder']`. |
| `launcherLabel` | `string` | `'Ask us'` | 1–40 characters. Text on the launcher. Shortcut for `texts['launcher.label']`. |
| `locale` | `string` | `'en'` | `'auto'`, or a BCP 47 tag such as `en` or `pl-PL`. Also the default answer language. `'auto'` uses the language of the embedding page, else the visitor's browser. |
| `texts` | `Partial<Record<TextKey, string>>` | `{}` | Any widget text by its key, 1–300 characters each. |
| `disclosure` | `false \| { privacyUrl?: string }` | shown, no link | The note that visitors talk to an AI. `privacyUrl` is an `https://` URL or a path on your app, such as `/privacy`. `false` hides the note. |
| `starters` | `string[]` | `[]` | Suggested questions on the welcome screen. Up to 4, 1–80 characters each. |
| `avatar` | `string` | none | A path on your app, such as `/avatar.png`, or a PNG, JPEG, WebP or GIF `data:` URL of up to 90,000 base64 characters. |
| `theme` | `PresetName \| ThemeDefinition` | `'aura'` | `'halo'`, `'aura'`, `'sage'`, `'care'`, or a theme from `defineTheme`. |
| `colorScheme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `'auto'` follows the visitor's system setting. |
| `css` | `string` | none | Your own CSS, up to 50,000 characters. It loads after the theme. |

The text defaults come from the built-in dictionary of the configured language. The table shows the English ones, which `'auto'` also uses. Texts ship in English and Polish.

## `createChatHandler`

`createChatHandler(options: ChatHandlerOptions): ChatHandlers` returns `GET`, `POST` and `DELETE` for the catch-all route. Its types are exported from `@boldare/askdare/next`: `ChatHandlerOptions`, `ChatHandlerLimitsOptions`, `ChatErrorReport`, `TrustProxy`, `ChatHandlers` and `RouteHandler`.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `bots` | `readonly Bot[]` | required | At least one bot. IDs must be unique. |
| `basePath` | `string` | `'/api/chat'` | Path of the catch-all route. One or more segments of letters, digits, `.`, `_`, `~` or `-`, each after a `/`. No trailing slash. |
| `openaiApiKey` | `string` | `process.env.OPENAI_API_KEY` | The OpenAI API key. |
| `secret` | `string` | `process.env.CHAT_SECRET` | Encrypts session tokens and attachment handles. At least 32 characters, with at least 12 different ones. Use `openssl rand -base64 32`. |
| `previousSecrets` | `readonly string[]` | `process.env.CHAT_SECRET_PREVIOUS`, split at commas | Former secrets that still verify tokens during a rotation. Each follows the same rule as `secret`. See [Going public](going-public.md#2-secrets-and-environment). |
| `identitySecret` | `string` | `process.env.IDENTITY_SECRET` | Checks identity tokens from your site's backend. Same rule as `secret`, and it must differ from it. Without one, identity is off. See [Signed-in visitors](identity.md). |
| `limits` | `ChatHandlerLimitsOptions` | see [Handler limits](#handler-limits) | The counter store, the client IP and a budget across bots. |
| `onError` | `(report: ChatErrorReport) => void` | one `console.error` line | Your error reporting. See [`onError`](#onerror). |
| `gallery` | `boolean` | `false` | Serves the state gallery. See [`gallery`](#gallery). |

A wrong `basePath`, a duplicate bot ID or an empty `bots` list throws a `TypeError` when the route loads. A missing key or a missing or weak secret doesn't stop the route from loading. Instead, requests that need it answer `bot_unavailable`, and `onError` receives the reason. In development (`next dev`), the chat itself says what to fix.

### Handler limits

`limits` in `createChatHandler` applies to every bot of the handler.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `store` | `RateLimitStore` | in memory, per process | Counter storage for rate limits and budgets. With more than one instance, use a shared store such as `@boldare/askdare-upstash`. See [Custom rate-limit store](custom-store.md). |
| `trustProxy` | `'auto' \| 'vercel' \| 'heroku' \| number` | `'auto'` | How to read the client IP behind your proxy. |
| `globalDailyTokens` | `number` | unlimited | Input plus output tokens per UTC day, across all bots of this handler. Reaching it answers `budget_exceeded`. |

### `trustProxy`

| Value | Client IP taken from |
| --- | --- |
| `'auto'` | Same as `'vercel'` when the `VERCEL` environment variable is set. Otherwise one trusted proxy, like `'heroku'`. |
| `'vercel'` | The `x-real-ip` header, else the first entry of `x-forwarded-for`. Vercel overwrites both. |
| `'heroku'` | The last entry of `x-forwarded-for`, which Heroku's router appends. Entries to its left may be spoofed. |
| a number `n` | The `n`-th entry from the right of `x-forwarded-for`, for `n` trusted proxies. Values below 1 count as 1. |

- IPv6 addresses count per /64 network.
- Without a usable address, the request counts as `unknown`, and all such requests share the per-IP limits.
- Never expose `next start` without a proxy in front. Clients then choose their own IP.

See [Deployment](deployment.md#behind-another-proxy-or-cdn) for setups with a CDN.

### `onError`

`onError` receives server errors (status 500 and up), any error that ends an answer while it streams, and once a day a `budget_exceeded` report when a bot's or the global budget runs out (never a single visitor's). Use it for your monitoring. It never receives message contents or API keys. Don't throw from it.

```ts
import * as Sentry from '@sentry/nextjs';

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  onError: ({ code, message, cause }) => {
    Sentry.captureException(cause ?? new Error(message), { tags: { askdare: code } });
  },
});
```

Without `onError`, askdare logs one `console.error` line with the code, what went wrong and a pointer to the troubleshooting guide.

`ChatErrorReport`:

| Field | Type | Meaning |
| --- | --- | --- |
| `code` | string union | The stable code the widget also receives. See the list below. |
| `message` | `string` | What went wrong, for you: a missing key, a model the project can't use. Never shown to visitors. |
| `cause` | `unknown` | The underlying error, with any API key cut down to its prefix. Optional. |

`code` is one of `invalid_input`, `unauthorized`, `session_expired`, `not_found`, `rate_limited`, `budget_exceeded`, `bot_unavailable`, `content_blocked` (reserved, not sent yet), `timeout`, `upstream_error` or `internal_error`. The codes at status 500 and up are `internal_error` (500), `upstream_error` (502), `bot_unavailable` (503) and `timeout` (504). [Protocol](protocol.md#error-codes) explains each one.

### `gallery`

`gallery: true` serves the state gallery. `<basePath>/embed/<bot>?gallery=<state>&preset=<preset>&scheme=<scheme>` then renders a fixed state of the widget without calling the model.

| Parameter | Values |
| --- | --- |
| `gallery` | `welcome`, `conversation`, `streaming`, `attachments`, `error`, `listening` |
| `preset` | `halo`, `aura`, `sage`, `care` |
| `scheme` | `auto`, `light`, `dark` |

It is for development and visual tests. Leave it off in production: `npx @boldare/askdare doctor` warns when it is on there.

### The route file

The route needs one setting outside `createChatHandler`:

```ts
export const maxDuration = 300;
```

It must be a literal in the route file. It is the longest a streamed answer may take, so keep it above every bot's `limits.turnTimeoutMs`.

## Environment variables

### Read by askdare

| Variable | Read by | Meaning |
| --- | --- | --- |
| `OPENAI_API_KEY` | `createChatHandler`, `npx @boldare/askdare kb sync`, `npx @boldare/askdare doctor` | The OpenAI API key. Default for `openaiApiKey`. Required. |
| `CHAT_SECRET` | `createChatHandler`, `npx @boldare/askdare doctor` | Default for `secret`. Required. `doctor` signs its request to your app with it. |
| `CHAT_SECRET_PREVIOUS` | `createChatHandler`, `npx @boldare/askdare doctor` | Former secrets, comma-separated. Default for `previousSecrets`. |
| `IDENTITY_SECRET` | `createChatHandler`, `npx @boldare/askdare doctor` | Default for `identitySecret`. Optional: without it, identity is off. |
| `ASKDARE_DISABLED` | `createChatHandler` | The kill switch. When it is exactly `true`, every bot answers `bot_unavailable`. askdare reads it on every request. |
| `KB_VECTOR_STORE_ID` | `npx @boldare/askdare kb sync` | The vector store to sync, unless you pass `--store`. |
| `ASKDARE_MODEL` | `npx @boldare/askdare doctor` | `doctor` reports it when it is missing or empty and your `askdare.config` uses it. The server doesn't read it; your config does. |
| `VERCEL` | `createChatHandler` | Set by Vercel. With `trustProxy: 'auto'`, askdare then reads the client IP the Vercel way. |
| `NODE_ENV` | `createChatHandler`, `defineBot` | Set by Next.js. With `production`, a store that isn't shared logs a warning, and theme contrast warnings are off. With `development`, the chat explains setup errors such as a missing key. |

The CLI reads `.env.local` and `.env`, or the file you pass with `--env-file`.

### Conventions

The library doesn't read these. `npx @boldare/askdare init`, the starter and the demo site use them in `askdare.config.ts` and the route.

| Variable | Used for | Notes |
| --- | --- | --- |
| `ASKDARE_MODEL` | `model: process.env.ASKDARE_MODEL ?? ''` | `init` writes it to `.env.local` (from `--model`). Set it in every environment that builds or runs the app; on Vercel, in Production and Preview. |
| `ASKDARE_TRANSCRIBE_MODEL` | `voice.model` | |
| `ASKDARE_ALLOWED_ORIGINS` | `security.allowedOrigins` | Comma-separated, as in the [example](#example). |
| `KB_VECTOR_STORE_ID` | `knowledge.vectorStoreId` | The first `npx @boldare/askdare kb sync` creates the store and prints its ID. |
| `ASKDARE_GALLERY` | `gallery: process.env.ASKDARE_GALLERY === '1'` | |

### `@boldare/askdare-upstash`

| Variable | Notes |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Default for the `url` option of `upstashStore()`. |
| `UPSTASH_REDIS_REST_TOKEN` | Default for the `token` option of `upstashStore()`. |
| `KV_REST_API_URL` | Used when `UPSTASH_REDIS_REST_URL` isn't set. |
| `KV_REST_API_TOKEN` | Used when `UPSTASH_REDIS_REST_TOKEN` isn't set. |

The Vercel Marketplace sets the `UPSTASH_` names. Databases from the older Vercel KV have the `KV_` names. The store reads them on first use, not at import.

## Where to go next

| To… | Read |
| --- | --- |
| Count limits in your own database | [Custom rate-limit store](custom-store.md) |
| Set secrets and limits before launch | [Going public](going-public.md) |
| Deploy to Vercel or Heroku | [Deployment](deployment.md) |
| Change texts, language or CSS | [Styling](styling.md) |
| Pick or adjust a theme | [Themes](themes.md) |
