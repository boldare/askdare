# Threat model

chatdock puts a public, anonymous chat endpoint on the internet that spends money on your OpenAI account and renders model output inside other people's websites. This document lists what we protect, how, and what remains your responsibility. The decisions behind it are in [ADR-0004](docs/adr/0004-threat-model.md).

**Guiding principle:** an anonymous public bot cannot be made unforgeable. A determined attacker can always use it as a rate-limited LLM. We **bound the damage** (requests, tokens and money per day) and **prevent escalation** (data access, script execution, data exfiltration).

## Assets

| Asset | Why it matters |
|---|---|
| OpenAI spend | Every message costs money; abuse turns into an invoice |
| Conversations | May contain personal data typed by visitors |
| Host pages | The widget runs on your clients' sites; it must not become an XSS vector |
| `OPENAI_API_KEY`, `CHAT_SECRET` | Full API access and the ability to mint session tokens |
| Visitor privacy | Tracking or leaking data across sites |

## Trust boundaries

```
host page ──(script tag)──▶ loader (shadow DOM, host origin)
    │                            │ MessagePort, explicit target origin
    ▼                            ▼
iframe app (your app origin, strict CSP) ──JSON + Bearer, same-origin──▶ chatdock route handler
                                                                             │
                                          OpenAI Responses / Conversations ◀─┤
                                          optional shared store (Upstash) ◀──┘
```

Everything to the left of the route handler is untrusted: the host page, the iframe's storage, the request body, and model output.

## Threats and controls

| # | Threat | Controls | Residual risk |
|---|---|---|---|
| T1 | **Cost abuse** (OWASP LLM10) | New sessions and conversations per IP; messages per visitor and per IP; turns per conversation; `max_output_tokens`; turn deadline; daily token budgets per bot, per IP and optionally global, **reserved atomically before each turn** and replaced by real usage when it ends; a turn whose model call has started finishes even if the visitor disconnects, so disconnecting saves nothing (an aborted response can't be looked up, usage included); only the server's deadline cuts a turn short, and that keeps the reservation charged; `CHATDOCK_DISABLED` kill switch; **hard spend limit on the OpenAI project** | An attacker rotating many IPs (or IPv6 /64s) can spend up to the bot's daily budget |
| T2 | **Reading someone else's conversation** (IDOR) | Conversation IDs never reach clients; resume tokens are encrypted (JWE), bound to bot and visitor; mismatches answer `404` | — |
| T3 | **Forged or stolen session tokens** | JWE with issuer, audience, type, expiry and required claims; keys looked up by `kid` with no fallback; claim formats validated; 15-minute access tokens kept in memory; key rotation with `CHAT_SECRET_PREVIOUS`; short or low-entropy secrets refused | Script running on your app origin could read the resume token from storage (the strict CSP keeps foreign script out). Anyone with physical access to a browser holding a resume token can continue that conversation, and ask the model to repeat it, for up to 30 days. An access token can be renewed up to 1 hour after it expires (so a visitor keeps their uploaded files), within the per-visitor session limit |
| T4 | **XSS through model output** (LLM05) | Markdown without raw HTML; links limited to http(s)/mailto; strict CSP on the iframe (`script-src 'self'`, no inline script); host page never receives model output | — |
| T5 | **Data exfiltration through links and images** (LLM01, LLM02) | Images are never loaded (alt text only); links open with `rel="noopener noreferrer nofollow"` | A visitor can still click a link the model was tricked into writing |
| T6 | **Prompt injection** (LLM01) | Instructions, model and tools are server-side only; clients can't send system messages; page context from `chatdock('configure')` is off unless a bot opts in, capped at 1000 characters, normalized, and sent as a marked part of the visitor's own turn (user role), never in the instructions | The model can be talked off-topic; don't connect tools with side effects to an anonymous bot (not supported in 0.1) |
| T7 | **System prompt leakage** (LLM07) | Documented rule: instructions contain no secrets | Assume visitors can extract the instructions |
| T8 | **Unauthorized embedding and clickjacking** | `Content-Security-Policy: frame-ancestors` per bot from `security.allowedOrigins`; no wildcards | `frame-ancestors` stops browsers, not scripts calling the API directly (see T1) |
| T9 | **postMessage spoofing** | Loader sends the handshake to an explicit origin and transfers a private `MessagePort`; the iframe accepts it only from its parent and allowed origins | — |
| T10 | **Cross-site requests and CSRF** | No cookies; Bearer tokens; JSON bodies, and uploads with custom headers, both need a CORS preflight we never grant; advisory `Origin`/`Host` and `Sec-Fetch-Site` checks; request bodies capped at 256 KB while streaming | Non-browser clients can still call the API, bounded by T1 controls |
| T11 | **Excessive agency** (LLM06) | Tools run on the server only, with Zod-validated arguments, timeouts, an output size cap and verified context (bot, visitor, locale); the model never chooses identifiers the tool trusts | Don't give an anonymous bot tools with side effects (not supported in 0.1) |
| T12 | **Secrets or content in logs** (LLM02) | Message content is never logged; client errors use stable codes without internals | Your own logging and hosting provider |
| T13 | **Rate-limit evasion with spoofed IPs** | Client IP read according to `trustProxy` (Vercel, Heroku or proxy count), never the spoofable leftmost `X-Forwarded-For` entry; addresses validated; IPv6 grouped by /64 | If `next start` is reachable without a proxy in front, the client controls `X-Forwarded-For` — always deploy behind a proxy that sets it |
| T14 | **Abuse attributed to your organization** | `safety_identifier` (hashed visitor ID) sent with every request, so OpenAI can act on the end user | — |
| T16 | **Malicious or oversized uploads** | Off by default; the type is detected from the file's bytes (PNG, JPEG, WebP, non-animated GIF, PDF; SVG and everything else refused); size capped while streaming (default 4 MB); uploads per visitor and per IP per hour; the widget re-encodes images, dropping EXIF and GPS data; file names sanitized; files are never served back to browsers; PDF pages counted from the file, object streams included, and capped (`maxPdfPages`), with unreadable structure charged at the cap; file tokens reserved for every model call the turn may make; a bot-wide daily upload cap | A PDF or image can still carry prompt injection (T6). A turn cut short by the server deadline stays charged at its reservation, so a PDF crafted to hide pages from the counter but not from OpenAI could then cost more than reserved; the project's hard spend limit bounds this |
| T17 | **Using someone else's files** (IDOR) | OpenAI file IDs never reach clients; uploads return encrypted handles bound to bot and visitor that expire after 1 hour; raw file IDs and foreign handles are refused | — |
| T18 | **Retention of uploaded files** | Files expire after 30 days (`expires_after`) and are deleted with the conversation | Files uploaded but never sent stay until they expire |
| T19 | **Voice input abuse** | Off by default; the microphone is allowed only in the embed page of a bot with voice (`Permissions-Policy`), and the browser asks the visitor; recordings are checked by their bytes (WebM, MP4, WAV, MP3) and capped by size (128 kbps × `maxSeconds`); dictations per visitor per hour; at most 2 per IP and 10 per bot transcribing at once; speech seconds reserved against daily budgets per bot and per IP, then settled with the duration OpenAI bills, or with the longest audio the file could hold when no duration is reported or the call times out; closing the chat or hiding the tab stops a dictation and releases the microphone, and recording stops by itself at `maxSeconds`; the transcript only fills the message field; chatdock stores no audio | A low-bitrate recording can hold more than `maxSeconds` of audio. Its real duration is charged after the fact, so the in-flight recordings can exceed a day's speech budget once, before it blocks further dictation |
| T20 | **Injection through widget configuration** | Theme values are validated before they are written into the theme stylesheet (hex colors, CSS values without `url()`, quotes, braces, semicolons or backslashes, so nothing can point to another origin; font-family characters only); variant attributes are fixed enums and HTML-escaped; the requested bot's launcher look replaces the quoted placeholder in `widget.js?bot=` as a JSON string literal (safe for any content, tested against the built loader), and no other bot's look is included; the avatar is a same-origin path or a raster data URL (no SVG, no other origins); `widget.css` is the developer's own CSS, loaded under the iframe's CSP (no external images, fonts or imports); `chatdock('configure')` accepts only a greeting, suggestions and page context, checked again in the iframe and on the server; the state gallery is off unless `createChatHandler({ gallery: true })` | A bot's public launcher look (colors, label, avatar path) is visible to anyone who loads its `widget.js` |
| T21 | **Probing the setup through `chatdock doctor`** | `POST /doctor` answers only to a 2-minute token encrypted with `CHAT_SECRET`, with its own type and audience, so session tokens don't work; the CLI sends it only over https (plain http to localhost) and never follows redirects; one run at a time per instance and 3 a minute across the app, and the kill switch stops it; the report holds statuses, model and vector store IDs and fixed messages, never keys or OpenAI's error text; the test conversation and file are deleted at once, and the test response isn't stored | Whoever knows `CHAT_SECRET` can start 3 runs a minute, each a few small OpenAI requests per bot (a 16-token response, one second of transcription) |
| T15 | **Supply-chain compromise** | Dependency install scripts blocked by default; one-day minimum release age; GitHub Actions pinned to SHAs; npm provenance via trusted publishing; reviewed and pinned agent skills | A compromised direct dependency that passes review |

## Your responsibilities

The library can't do these for you. [The going-public guide](docs/going-public.md) walks through each one:

1. A **dedicated OpenAI project**: a restricted key, a model allowlist and a **hard spend limit** with alerts.
2. A random `CHAT_SECRET` of at least 32 characters, kept out of git, with a rotation plan.
3. An accurate `security.allowedOrigins` list.
4. A **shared rate-limit store** (`@boldare/chatdock-upstash`) when more than one instance serves traffic.
5. The right `trustProxy` setting for your hosting.
6. Instructions with no secrets in them.
7. A privacy notice, a retention decision (conversations stay in OpenAI until deleted, ADR-0003) and an AI disclosure.

## Reporting

See [SECURITY.md](SECURITY.md).
