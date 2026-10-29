# Wire protocol (version 1)

This is how the chatdock server streams a chat turn to its clients: the embed iframe app now, `@boldare/chatdock/react` later. The protocol belongs to chatdock; raw OpenAI stream events are never forwarded ([ADR-0002](adr/0002-openai-only-no-leaked-types.md)).

Source of truth: `packages/chatdock/src/protocol/`.

## Transport

- **Request:** `POST` with a JSON body and a `Bearer` access token. No cookies.
- **Response:** Server-Sent Events. Clients read them with `fetch` and a `ReadableStream`, because `EventSource` can't send a POST body.
- **Response headers:**
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `x-chatdock-protocol: 1`
- **Framing:** one event per frame, `event: <type>` followed by `data: <json>` and a blank line. The JSON always repeats `type`.
- **First byte:** the server sends a comment (`: ok`) before contacting OpenAI. Heroku requires a first byte within 30 s.
- **Heartbeat:** a `: ping` comment every 15 s, on a timer that is independent of model output. Heroku closes connections after 55 s without bytes.

## Events

| Type | Payload | Meaning |
|---|---|---|
| `conversation.created` | `resumeToken` | A new conversation started; store the token to resume it later |
| `user.ack` | `messageId` | The server accepted the user's message and assigned it this ID |
| `message.start` | `messageId` | The assistant started a reply |
| `reasoning` | `messageId`, `state: started \| done` | The model is thinking; show a status, never content |
| `text.delta` | `messageId`, `delta` | Append text to the reply (markdown) |
| `citation` | `messageId`, `index`, `title`, `url?` | Source for marker `[index]`; `url` is http(s) only |
| `tool.status` | `messageId`, `callId`, `name`, `state: running \| done \| error` | A tool ran; arguments and results stay on the server. `name: file_search` is the knowledge base search |
| `message.end` | `messageId`, `reason` | The reply finished. Reasons: `completed`, `max_steps`, `max_output_tokens`, `timeout`, `content_filter`, `aborted` |
| `error` | `code`, `message`, `retryAfterMs?` | The turn failed; `message` is safe to show |

## Attachments

When a bot has `attachments` enabled, files travel separately from the message:

1. `POST /attachments` with the raw file as the body (`Content-Type: application/octet-stream`), the `Bearer` token, and two headers: `x-chatdock-bot` (bot ID) and `x-chatdock-filename` (URL-encoded name). The server detects the type from the bytes, uploads the file to OpenAI and answers `{ "attachment": { "id", "kind": "image" | "pdf", "name", "size" } }`.
2. `POST /messages` with `"attachments": ["<id>", …]` next to `text`. `text` may be empty when files are attached.

`id` is an encrypted handle bound to the bot and the visitor, valid for 1 hour. OpenAI file IDs never reach clients, and the server refuses raw file IDs. History (`POST /history`) reports only how many files a message had.

## Dictation

When a bot has `voice` enabled, `POST /transcriptions` takes a recording as the raw body (`Content-Type: application/octet-stream`) with the `Bearer` token and two headers: `x-chatdock-bot` (bot ID) and `x-chatdock-languages` (comma-separated language tags, used as hints). It answers `{ "text": "…" }`. Clients put the text in the message field for the visitor to check; nothing is sent to the model.

## Identity

`POST /session` takes an optional `identityToken`: the JWT from `chatdock('identify')`, or `null` to sign out. Without it, a renewal keeps the identity the previous access token had. Widgets send the page's latest token with every session request. The answer adds `identified` (boolean), `identityKey` (an HMAC that tells users apart without revealing them; widgets keep one conversation handle per key), `resumeToken` when signing in adopted an anonymous conversation, and `identityProblem` when a token was refused. A signed-in access token expires with the identity token. Identities travel inside the encrypted access token; clients never see the claims ([ADR-0009](adr/0009-visitor-identity.md)).

## Diagnostics

`POST /doctor` serves `npx @boldare/chatdock doctor`. It takes a 2-minute token that the CLI encrypts with `CHAT_SECRET` and answers with a report on each bot: whether the server's key, models, vector store and permissions work. The report format is internal and may change in any release.

## Error codes

These codes are stable and safe to branch on in the UI:

| Code | Meaning |
|---|---|
| `invalid_input` | The request was rejected as malformed or too long |
| `unauthorized` | The access token is missing or invalid |
| `session_expired` | The access token expired; refresh it and retry |
| `not_found` | Unknown bot or conversation (also returned for conversations you don't own) |
| `rate_limited` | Too many requests; wait `retryAfterMs` |
| `budget_exceeded` | The bot's daily budget is spent |
| `bot_unavailable` | The bot is disabled (kill switch) or misconfigured |
| `content_blocked` | Moderation rejected the input or output |
| `timeout` | The turn exceeded the server deadline |
| `upstream_error` | OpenAI failed |
| `internal_error` | Unexpected server error |

## Client rules

- **Tolerate the unknown.** Ignore unknown event types and unknown fields. Newer servers may add them within the same protocol version.
- **Check the version.** Compare `x-chatdock-protocol` with the version the client supports. On a mismatch, show a "please reload" state.
- **Run a watchdog.** If no bytes (events or comments) arrive for 45 s, abort and re-fetch the conversation history.
- **Render text safely.** Treat `text.delta` content as untrusted markdown and sanitize it before rendering.

## Versioning

- **Adding** an event type or an optional field is not breaking.
- **Removing or renaming** an event or field, or changing a field's meaning, is breaking. It bumps the protocol version and requires a minor release of `@boldare/chatdock` (ADR-0006).
