# Troubleshooting

Each entry starts with what you see, then says why it happens and what to do. askdare's error lines in the server log start with `[askdare]` and end with a pointer to this page.

## Find the error first

- **Setup problems are explained in plain words** in the server log, in development and in production. In development the chat shows the same explanation when the problem shows up while it answers a message. In production the chat only shows a generic text.
- **The server log** gets one line for every server error (status 500 and up) and for every error during a streamed answer:

  ```text
  [askdare] bot_unavailable: OPENAI_API_KEY is not set. Add it to .env.local (or your host's environment) and restart the app. (see node_modules/@boldare/askdare/docs/troubleshooting.md)
  ```

  Refusals such as `rate_limited` and `budget_exceeded` aren't logged. If you pass `onError` to `createChatHandler`, errors go to your function instead of the log.
- **The browser's network tab** shows the requests under `/api/chat/`. A failed request answers with JSON such as `{ "error": { "code": "rate_limited", "message": "…" } }`. A streamed answer reports its error as an `error` event.
- **The browser console of the page that embeds the chat** shows warnings from the loader, such as a site missing from `allowedOrigins`.
- **`npx @boldare/askdare doctor`** checks the project, the environment and the running app. For a deployed app, add `--url <your app> --env-file <file with its CHAT_SECRET>` ([Command line](cli.md#doctor)).

## Error codes

The codes are stable. The texts are the English defaults; the widget shows them in the visitor's language when a translation exists.

| Code | HTTP | The chat says | See |
| --- | --- | --- | --- |
| `invalid_input` | 400 | "The request was invalid.", or a specific text such as "Messages can be up to {max} characters." | [Attachments are rejected](#attachments-are-rejected) |
| `unauthorized` | 401 | "Authentication is required." | [Session expired](#session-expired) |
| `session_expired` | 401 | "Your session has expired. Please try again." | [Session expired](#session-expired) |
| `not_found` | 404 | "Not found.", or "This conversation is no longer available." | [The conversation is gone](#the-conversation-is-gone) |
| `content_blocked` | 422 | "This message cannot be processed." | askdare doesn't send this code in this version |
| `rate_limited` | 429 | "Too many messages. Please wait a moment.", or a specific text | [Too many messages](#too-many-messages) |
| `budget_exceeded` | 429 | "The assistant is unavailable for the rest of the day." | [Unavailable for the rest of the day](#unavailable-for-the-rest-of-the-day) |
| `internal_error` | 500 | "Something went wrong. Please try again." | The server log; also [In-memory rate limits](#in-memory-rate-limits) |
| `upstream_error` | 502 | "The assistant is temporarily unavailable. Please try again." | [OpenAI fails](#openai-fails) |
| `bot_unavailable` | 503 | "The assistant is currently unavailable." | [The assistant is unavailable](#the-assistant-is-unavailable) |
| `timeout` | 504 | "The assistant took too long to respond. Please try again." | [Answers are cut off or time out](#answers-are-cut-off-or-time-out) |

Some texts come from the widget itself, without a server code:

| The chat says | See |
| --- | --- |
| "Connection problem. Please try again." | [Connection problem](#connection-problem) |
| "The chat couldn’t load. Please try again later." | [The chat doesn't load](#the-chat-doesnt-load) |
| "The assistant was updated. Please reload the page." | [The assistant was updated](#the-assistant-was-updated) |
| "The connection stalled. Please try again." | [Answers are cut off or time out](#answers-are-cut-off-or-time-out) |
| "Could not load the previous conversation." | [The conversation is gone](#the-conversation-is-gone) |

## Model is required

**You see** this when the app starts, when `next build` runs, or on every request to `/api/chat`:

```text
[askdare] Invalid bot "support": model is required. Set the model in the bot definition, usually as model: process.env.ASKDARE_MODEL with ASKDARE_MODEL in .env.local and in every environment that builds or runs the app (on Vercel: Production and Preview).
```

**Why:** `defineBot` checks the bot as soon as your config is imported, and `next build` imports it too. The config that `init` writes reads the model from `ASKDARE_MODEL`. When the variable is missing or empty, the model is empty and the bot is refused. askdare never picks a model for you.

**Fix:**
1. Set `ASKDARE_MODEL` to a current OpenAI model your project may use, in `.env.local` for development.
2. Set it in every environment of your host that builds or runs the app. On Vercel that means Production **and** Preview; preview deployments fail to build without it.
3. Restart `next dev`, or redeploy.

`npx @boldare/askdare doctor` reports it as "ASKDARE_MODEL is not set." or "ASKDARE_MODEL is empty."

### Other `Invalid bot` messages

The same check reports every invalid setting as `Invalid bot "<id>": <setting> <problem>`. The most common ones:

| Message | Fix |
| --- | --- |
| `security.allowedOrigins.0 must be an https origin like https://www.example.com (no path or wildcard; http only for localhost)` | Use the scheme and host only, such as `https://www.example.com`, with no trailing slash |
| `id use 1-48 lowercase letters, digits or dashes` | Rename the bot, and update `?bot=` in the script tag |
| `knowledge.vectorStoreId must be a vector store ID like vs_…` | Set `KB_VECTOR_STORE_ID` to the ID that `kb sync` printed |
| `voice.model is required` | Set a transcription model in `voice` |

`createChatHandler` refuses `Duplicate bot id "<id>"`, an empty `bots` list (`Define at least one bot.`) and a `basePath` that doesn't look like `/api/chat`.

## The assistant is unavailable

**You see** "The assistant is currently unavailable." (`bot_unavailable`) after sending a message. In development, the chat shows the reason instead, and the server log has the same line.

**Why**, by the explanation in the log:

| Explanation | Cause |
| --- | --- |
| `OPENAI_API_KEY is not set. Add it to .env.local (or your host's environment) and restart the app.` | The key is missing where the app runs |
| `OpenAI rejected the API key (401). Check OPENAI_API_KEY and the key's project permissions.` (or `403`) | The key is wrong, revoked, or a restricted key lacks a permission |
| `The bot's model doesn't exist or this OpenAI project can't use it: …` | A typo in the model, a retired model, or a model outside the project's allowlist |
| No explanation | `ASKDARE_DISABLED` is `true`; see [The kill switch](#the-kill-switch) |

**Fix:**
- Set `OPENAI_API_KEY` in `.env.local` or in your host's settings, then restart the app or redeploy.
- Run `npx @boldare/askdare doctor`. It tests the key, the model and each permission the key needs, and names the missing one.
- For a model problem, check the model ID and the project's model allowlist in the OpenAI dashboard.

Problems with `CHAT_SECRET` and `IDENTITY_SECRET` are also `bot_unavailable`: they stop the chat from opening a session. In development the chat shows the reason; the table in the next entry lists them.

## Connection problem

**You see** "Connection problem. Please try again." when sending a message, or "Could not load the previous conversation." when the chat opens.

**Why:** the network failed, or the server didn't answer. When the server refuses a session (`POST /api/chat/session`), the chat shows the server's own message instead: in development the reason in plain words, in production the generic text of its code (for example "The assistant is currently unavailable."). The server log always has the reason. Common causes of a refused session:

| Server log or session response | Cause |
| --- | --- |
| `CHAT_SECRET is not set. Add it to .env.local (or your host's environment) and restart the app.` | `CHAT_SECRET` is missing where the app runs |
| `CHAT_SECRET must be at least 32 random characters. Generate one with: node -e "…"` | The secret is shorter than 32 characters, or has fewer than 12 different characters. The same applies to each value in `CHAT_SECRET_PREVIOUS` |
| `IDENTITY_SECRET must be at least 32 random characters …` or `IDENTITY_SECRET must differ from CHAT_SECRET.` | `IDENTITY_SECRET` is set but weak, or equal to `CHAT_SECRET` |
| `bot_unavailable` with no explanation | `ASKDARE_DISABLED` is `true` |
| `rate_limited` (429) | More than `sessionsPerIpPerHour` new sessions from one IP; see [Too many messages](#too-many-messages) |
| `unauthorized`, "Cross-origin requests are not allowed." | A proxy in front of the app changes the `Host` header, so it no longer matches the `Origin` of the chat's own requests |

**Fix:**
1. Read the chat's message in development, or the server log. The failed `session` request's JSON body has the same explanation.
2. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, set it as `CHAT_SECRET`, and restart the app or redeploy.
3. Run `npx @boldare/askdare doctor`. It checks the strength of `CHAT_SECRET`, `CHAT_SECRET_PREVIOUS` and `IDENTITY_SECRET`.

## The chat doesn't load

**You see** an empty panel, then after 8 seconds "The chat couldn’t load. Please try again later." The browser console of the embedding page says:

```text
[askdare] The chat "support" didn't load on https://www.example.com. Is this origin in the bot's security.allowedOrigins? Check with: npx @boldare/askdare doctor --origin https://www.example.com
```

**Why:** the chat runs in an iframe served by your app. The app tells browsers which sites may show that iframe (`Content-Security-Policy: frame-ancestors`), from the bot's `security.allowedOrigins` plus the app's own origin. On any other site the browser refuses to show it. Less often:
- the bot ID in `widget.js?bot=` doesn't exist;
- something in front of `/api/chat` (`proxy.ts`, `headers()` in `next.config`, a CDN rule) adds `X-Frame-Options` or a second Content Security Policy;
- the embedding site's own Content Security Policy doesn't allow the app's origin in `frame-src` ([Embedding](embedding.md#your-sites-content-security-policy)).

**Fix:**
1. Add the exact origin to `security.allowedOrigins`: scheme and host, plus the port if it isn't the default. `https://example.com` and `https://www.example.com` are different origins.
2. Deploy the app.
3. Check it:

   ```bash
   npx @boldare/askdare doctor --url https://your-app.example.com --env-file .env.production.local --origin https://www.example.com
   ```

   `doctor` reports "https://www.example.com may embed the chat." or says what to add. It also reports `X-Frame-Options` and a second Content Security Policy. The header checks run with the live checks, so the env file must hold the app's `CHAT_SECRET`.

If the console says "Load the widget as widget.js?bot=<bot id>.", the script tag has no bot ID.

## Too many messages

**You see** "Too many messages. Please wait a moment." (`rate_limited`), usually while testing.

**Why:** askdare limits requests per visitor, per client IP and per bot. In development every browser and tab on your machine counts as the same IP, so the per-IP limits come first.

| Limit | Default | Counted per |
| --- | --- | --- |
| `messagesPerVisitorPerMinute` | 10 | visitor |
| `messagesPerIpPerMinute` | 30 | IP |
| `conversationsPerIpPerHour` | 20 | IP |
| `sessionsPerIpPerHour` | 30 | IP (new visitors) |
| `uploadsPerVisitorPerHour` | 20 | visitor |
| `uploadsPerIpPerHour` | 60 | IP |
| `uploadsPerDay` | 500 | bot |
| `transcriptionsPerVisitorPerHour` | 30 | visitor |
| `maxTurns` | 50 | conversation |

Every limit is in [Configuration](configuration.md#limits). Some are fixed: 12 session renewals per returning visitor per hour, 20 history loads or deletions per visitor per minute, and 2 dictations per IP and 10 per bot being transcribed at once. Windows start with the first request, so a limit of one hour lasts one hour from then.

Two limits have their own text:
- "This conversation is too long. Please start a new one." means the conversation reached `maxTurns`.
- "Another dictation is still being transcribed. Please try again in a moment." means too many dictations are being transcribed at once.

**Fix:**
- Wait for the window to pass, or restart `next dev`: the default counters live in the server's memory.
- Raise the limits in development only:

  ```ts
  const development = process.env.NODE_ENV === 'development';

  defineBot({
    // …
    limits: development
      ? { messagesPerIpPerMinute: 300, conversationsPerIpPerHour: 200, sessionsPerIpPerHour: 300 }
      : undefined,
  });
  ```

- With `@boldare/askdare-upstash` in development, give it its own database or key prefix, such as `upstashStore({ prefix: 'askdare-dev:' })`, so tests don't use up production counters.

### Every visitor is rate-limited

**You see** `rate_limited` in production for many visitors at once, while traffic is low.

**Why:** askdare reads the client IP from `X-Forwarded-For`, according to `trustProxy`. When it reads the wrong entry, every visitor counts as the same address: a CDN in front of Heroku, for example. Without a proxy that sets the header, the IP is unknown and every visitor shares one counter.

**Fix:** set `limits: { trustProxy: <number of proxies> }` in `createChatHandler` (Vercel and a plain Heroku app need nothing), and never expose `next start` directly. See [Deployment](deployment.md#behind-another-proxy-or-cdn).

## Unavailable for the rest of the day

**You see** "The assistant is unavailable for the rest of the day." (`budget_exceeded`).

**Why:** a daily budget is used up. Before each message, askdare reserves its expected tokens against every budget; when one would go over, the message is refused. The budgets reset at 00:00 UTC, and the response's `Retry-After` header counts down to then.

| Budget | Default | Where |
| --- | --- | --- |
| `dailyTokens` | 2,000,000 tokens per bot | `limits` in `defineBot` |
| `dailyTokensPerIp` | 200,000 tokens per IP and bot | `limits` in `defineBot` |
| `globalDailyTokens` | unlimited | `limits` in `createChatHandler` |
| `voiceSecondsPerDay` | 3,600 seconds per bot | `limits` in `defineBot` |
| `voiceSecondsPerIpPerDay` | 600 seconds per IP and bot | `limits` in `defineBot` |

A dictation that hits a speech budget says "Dictation is unavailable for the rest of the day. You can still type." Typing still works.

**It happens right after attaching a PDF:** each PDF page reserves about 2,000 tokens for every model call, so a 50-page PDF holds 100,000 tokens, half of the default `dailyTokensPerIp`. A visitor who sends several large PDFs uses up their day quickly. On a bot with tools, a call that the budget can't cover is skipped: the model answers from the files without calling tools. Lower `attachments.maxPdfPages` or raise `dailyTokensPerIp` if visitors need more.

When a whole bot's budget or the global one runs out, the server log says so once a day, for example `[askdare] budget_exceeded: The daily token budget of bot "support" (limits.dailyTokens) is used up until 00:00 UTC.`, and `onError` receives it. A single visitor's budget is never reported.

**Fix:** wait until 00:00 UTC, or raise the budget and restart. While testing, restarting `next dev` clears the in-memory counters. Before raising budgets in production, read [Costs](costs.md).

## The assistant was updated

**You see** "The assistant was updated. Please reload the page." on every message.

**Why:** the widget checks the protocol version that the server sends with each answer, in the `x-askdare-protocol` response header. It shows this text when the header is missing or differs from its own version. That happens when:
- a tab stayed open across an askdare upgrade that changed the protocol; or
- something between the browser and the app removes the header: a proxy, a CDN, or code in `proxy.ts` that rebuilds the response. Then it happens after every reload too.

**Fix:** reload the page. If the message comes back, check the `messages` request in the network tab: its response must have `x-askdare-protocol` and `Content-Type: text/event-stream`. Leave `/api/chat` out of anything that rewrites responses.

## Session expired

**You see** "Your session has expired. Please try again." (`session_expired`) or "Authentication is required." (`unauthorized`).

**Why:** sessions last 15 minutes. The widget renews them by itself and repeats a refused request once, so visitors rarely see these texts. When they do, the renewed session was refused too. The usual cause is instances that don't share the same `CHAT_SECRET`: a session from one instance is unreadable on another, for example during a deployment that changed the secret.

**Fix:** use the same `CHAT_SECRET` on every instance. When you change it, move the old value to `CHAT_SECRET_PREVIOUS` first ([Going public](going-public.md#2-secrets-and-environment)). Then reload the page.

## The conversation is gone

**You see** "This conversation is no longer available." (`not_found`), or "Could not load the previous conversation." when the chat opens.

**Why:**
- "This conversation is no longer available." means OpenAI no longer has the conversation, for example because it was deleted. The widget forgets it, and the next message starts a new one.
- "Could not load the previous conversation." means the history request failed: often a refused session ([Connection problem](#connection-problem)), or OpenAI didn't answer.

A conversation can also disappear without a message. The browser's handle to it expires 30 days after the last answer. After that, or after `CHAT_SECRET` changed without `CHAT_SECRET_PREVIOUS`, the chat quietly starts a new one.

**Fix:** for the second text, check the server log and the `session` and `history` requests in the network tab.

## The microphone doesn't work

**You see** no microphone button, or one of these texts:

| Text | Cause |
| --- | --- |
| "Microphone access is blocked. Allow it in your browser to dictate." | The visitor refused permission, or the embedding page doesn't let the iframe use the microphone (Safari shows this instead of hiding the button) |
| "No microphone was found." | No microphone is connected |
| "The microphone could not be started." | The browser can't record, or the microphone failed |
| "Nothing was recorded. Please try again." | The recording was almost empty, for example when **Done** was pressed right away |
| "This assistant does not accept voice input." | The bot has no `voice` |
| "This recording format is not supported." or "This recording is too long." | The server refused the file: not WebM, MP4, WAV or MP3, or bigger than `maxSeconds` allows |
| "The recording could not be transcribed." | The answer to the `transcriptions` request held no transcript, for example because something in front of the app answered instead; check the network tab |

**Why the button is missing:** the bot has no `voice`, the browser can't record, or the embedding page forbids the microphone. The loader's iframe asks for it (`allow="microphone"`), but a page that sends `Permissions-Policy: microphone=()`, or allows it only for itself, can't pass it on to the chat.

**Fix:**
- Add `voice: { model: '…' }` to the bot ([Voice input](voice-input.md)).
- If your site sends a `Permissions-Policy` header, allow the microphone for the app's origin too, for example `microphone=(self "https://your-app.example.com")` ([Voice input](voice-input.md#embedding)).
- Ask visitors who refused to allow the microphone in the browser's site settings.

## Attachments are rejected

**You see** one of these texts after choosing a file:

| Text | Cause and fix |
| --- | --- |
| "This assistant does not accept files." | The bot has no `attachments`. Add `attachments: {}` ([Attachments](attachments.md)) |
| "This file type is not supported." or "Only images (PNG, JPEG, WebP, GIF) and PDF files are supported." | The type is detected from the file's bytes. SVG, animated GIF and WebP, and anything else are refused. With `images: false` or `pdf: false` the text names the remaining type |
| "Too large (max {size})." or "Files can be up to {size}." | Larger than `maxBytes` (default 4 MB). On Vercel, requests can't exceed 4.5 MB, so don't raise it there |
| "PDFs can have up to {max} pages." | More pages than `maxPdfPages` (default 50) |
| "You can attach up to {count} files per message." or "Attach up to {count} files per message." | More than `maxPerMessage` (default 3) |
| "An attachment expired or is invalid. Please attach it again." | Uploaded files must be sent within 1 hour, by the same visitor. It also happens after `CHAT_SECRET` changed |
| "The file could not be uploaded." | The upload answered with something unexpected; check the network tab |
| "Too many messages. Please wait a moment." | An upload limit was reached; see [Too many messages](#too-many-messages) |

A PDF that passes these checks can still be refused with `budget_exceeded`; see [Unavailable for the rest of the day](#unavailable-for-the-rest-of-the-day).

## Answers are cut off or time out

**The answer stops mid-sentence, or is empty.** The model reached `limits.maxOutputTokens` (default 1,024 per model call). With a reasoning model, its reasoning counts toward the same limit, so it can use it up before writing anything visible. Raise `maxOutputTokens`, or ask for shorter answers in the instructions.

**"The assistant took too long to respond. Please try again."** (`timeout`). The whole answer, tool calls included, took longer than `limits.turnTimeoutMs` (default 120 seconds). Raise it, and check your tools' `timeoutMs`.

**Answers stop after the same number of seconds.** The host ended the request before askdare did. On Vercel, the route's `maxDuration` must be at least `turnTimeoutMs` plus 15 seconds, as a literal in the route file. `doctor` warns:

```text
! An answer may take up to 120 s, but the route's maxDuration is 60 s.
    → Raise maxDuration to at least 135, or lower limits.turnTimeoutMs.
```

On Heroku, use `--keepAliveTimeout 95000` in the `Procfile` ([Deployment](deployment.md#heroku)).

**"The connection stalled. Please try again."** The widget received nothing for 45 seconds, although the server sends a heartbeat every 15 seconds. Something between the browser and the app buffers the stream. Turn off buffering of `text/event-stream` for `/api/chat`; askdare already sends `X-Accel-Buffering: no` for nginx.

## OpenAI fails

**You see** "The assistant is temporarily unavailable. Please try again." (`upstream_error`). The server log shows OpenAI's status, error code and request ID.

**Why:** askdare couldn't reach OpenAI, or OpenAI refused or failed the request for a reason other than a rejected key or an unknown model: its own rate limits, an outage, or a project that ran out of credit or reached its hard spend limit.

**Fix:** check the OpenAI status page and the project's usage, limits and billing in the OpenAI dashboard. `doctor` reports a spent project as "The OpenAI project is out of credit or reached its spend limit."

## In-memory rate limits

**You see** this in the production log:

```text
[askdare] Rate limits are kept in memory, per instance. With more than one instance, use a shared store such as @boldare/askdare-upstash.
```

`doctor` reports it as "Rate limits and budgets are kept in memory, per instance."

**Why:** `createChatHandler` has no `limits.store`, so every instance keeps its own counters. That is fine for one server or one Heroku dyno. With several instances, each one allows the full limits and budgets, and a restart or deployment resets them.

**Fix:** with more than one instance, use the shared store ([Going public](going-public.md#4-rate-limits-across-instances)). With exactly one, you can ignore the warning.

Related errors:
- `[askdare] In-memory rate-limit store is full; use a shared store.` The memory store holds at most 50,000 counters and never forgets a budget, so it refuses requests instead. Visitors see "Something went wrong. Please try again."
- `[askdare-upstash] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or pass a client.` The shared store has no credentials where the app runs.

## The kill switch

`ASKDARE_DISABLED=true` switches off every bot of the app. The value must be exactly `true`.

**What it does:** sessions, messages, history, uploads, dictations and `doctor` runs are refused with `bot_unavailable`. Visitors see "The assistant is currently unavailable." The launcher still shows. Answers that already started finish.

**Why it seems not to work:** askdare reads the variable on every request, but most hosts only pass a changed variable to the app after a restart. On Vercel, redeploy. On Heroku, changing a config var restarts the dynos. Locally, restart `next dev`.

**To act faster**, revoke the API key in the OpenAI dashboard. Every message then fails with `bot_unavailable`, and you need a new key afterwards.

**To switch back on**, remove the variable or set it to anything else, and restart or redeploy.

## Doctor can't check the app

| `doctor` says | Fix |
| --- | --- |
| "Skipped: the live checks need CHAT_SECRET." | Run it where `.env.local` has `CHAT_SECRET`, or pass `--env-file` |
| "The app rejected the doctor's token: its CHAT_SECRET differs from yours." | Pass the env file of that environment, such as `--env-file .env.production.local` |
| "The app is switched off (ASKDARE_DISABLED) or has no CHAT_SECRET where it runs." | See [The kill switch](#the-kill-switch) and [Connection problem](#connection-problem) |
| "Too many doctor runs at once or this minute." | Wait a minute; the app allows 3 runs a minute |
| "No askdare route at …" | Check `--url` and `--base-path`, and the route file |
