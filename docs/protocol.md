# Wire protocol (version 1)

This is how the askdare server streams a chat turn to its clients: the embed iframe app now, `@boldare/askdare/react` later. The protocol belongs to askdare; raw OpenAI stream events are never forwarded ([ADR-0002](adr/0002-openai-only-no-leaked-types.md)).

Source of truth: `packages/askdare/src/protocol/`.

## Endpoints

Every path sits under the route's base path: `/api/chat` by default, or `basePath` in `createChatHandler`. Any other path or method answers `404`.

| Method and path | Token | Purpose |
| --- | --- | --- |
| `GET /widget.js` | None | The loader script for your pages. `?bot=<id>` adds that bot's launcher look |
| `GET /embed/<bot>` | None | The chat document in the iframe. `?lang=<tag>` carries the embedding page's language for `locale: 'auto'`, and `?mode=inline` marks a chat inside the page |
| `GET /theme/<bot>.css` | None | The bot's theme and `widget.css`, with a content hash in `?v=` |
| `GET /assets/<file>` | None | The chat's script and stylesheet, and the preset fonts |
| `POST /session` | None | Starts or renews a visitor's session and answers an access token ([Identity](#identity)) |
| `POST /messages` | Access token | Sends a message and answers with the event stream ([Events](#events)) |
| `POST /history` | Access token | The visible messages of the visitor's conversation |
| `DELETE /conversation` | Access token | Deletes the visitor's conversation, and its files when the bot accepts attachments |
| `POST /attachments` | Access token | Uploads one file ([Attachments](#attachments)) |
| `POST /transcriptions` | Access token | Transcribes one dictation ([Dictation](#dictation)) |
| `POST /doctor` | Doctor token | Checks the setup for `askdare doctor` ([Diagnostics](#diagnostics)) |

- **`POST /messages`** takes `{ "botId", "text", "resumeToken"?, "attachments"?, "context"?, "locale"? }`. Without `resumeToken`, the server starts a new conversation and sends `conversation.created`. `locale` is the visitor's language tag, passed to the bot's instructions.
- **`POST /history`** takes `{ "botId", "resumeToken" }` and answers `{ "messages": [{ "id", "role", "text", "citations", "attachments" }] }`, where `attachments` is a count.
- **`DELETE /conversation`** takes the same body and answers `204` with no body.
- **Same origin only.** Every `POST` and `DELETE` except `/doctor` refuses cross-site requests with `401`. The API serves the chat's own iframe, which runs on the same origin.

## Transport

- **Request:** `POST` with a JSON body and a `Bearer` access token. No cookies.
- **Response:** Server-Sent Events. Clients read them with `fetch` and a `ReadableStream`, because `EventSource` can't send a POST body.
- **Response headers:**
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `x-askdare-protocol: 1`
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
| `message.end` | `messageId`, `reason`, `resumeToken?` | The reply finished. A resumed conversation gets a fresh `resumeToken`, so it stays reachable 30 days after its last message. Reasons: `completed`, `max_steps`, `max_output_tokens`, `timeout`, `content_filter`, `aborted` |
| `error` | `code`, `message`, `retryAfterMs?`, `key?`, `params?` | The turn failed; `message` is safe to show ([keys and parameters](#error-keys-and-parameters)) |

## Attachments

When a bot has `attachments` enabled, files travel separately from the message:

1. `POST /attachments` with the raw file as the body (`Content-Type: application/octet-stream`), the `Bearer` token, and two headers: `x-askdare-bot` (bot ID) and `x-askdare-filename` (URL-encoded name). The server detects the type from the bytes, uploads the file to OpenAI and answers `{ "attachment": { "id", "kind": "image" | "pdf", "name", "size" } }`.
2. `POST /messages` with `"attachments": ["<id>", …]` next to `text`. `text` may be empty when files are attached.

`id` is an encrypted handle bound to the bot and the visitor, valid for 1 hour. OpenAI file IDs never reach clients, and the server refuses raw file IDs. History (`POST /history`) reports only how many files a message had.

## Dictation

When a bot has `voice` enabled, `POST /transcriptions` takes a recording as the raw body (`Content-Type: application/octet-stream`) with the `Bearer` token and two headers: `x-askdare-bot` (bot ID) and `x-askdare-languages` (comma-separated language tags, used as hints). It answers `{ "text": "…" }`. Clients put the text in the message field for the visitor to check; nothing is sent to the model.

## Identity

`POST /session` takes an optional `identityToken`: the JWT from `askdare('identify')`, or `null` to sign out. Without it, a renewal keeps the identity the previous access token had. Widgets send the page's latest token with every session request. The answer adds `identified` (boolean), `identityKey` (an HMAC that tells users apart without revealing them; widgets keep one conversation handle per key), `resumeToken` when signing in adopted an anonymous conversation, and `identityProblem` when a token was refused. A signed-in access token expires with the identity token. Identities travel inside the encrypted access token; clients never see the claims ([ADR-0009](adr/0009-visitor-identity.md)).

## Diagnostics

`POST /doctor` serves `npx @boldare/askdare doctor`. It takes a 2-minute token that the CLI encrypts with `CHAT_SECRET` and answers with a report on each bot: whether the server's key, models, vector store and permissions work. The report format is internal and may change in any release.

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
| `content_blocked` | Reserved for moderation; this version never sends it |
| `timeout` | The turn exceeded the server deadline |
| `upstream_error` | OpenAI failed |
| `internal_error` | Unexpected server error |

## Error keys and parameters

Next to `code` and `message`, an `error` event can carry:

| Field | Meaning |
| --- | --- |
| `retryAfterMs` | How long to wait before retrying, in milliseconds |
| `key` | The [text key](texts.md) for this error, such as `error.messageLength`, so a client can show it in the visitor's language |
| `params` | Values for the placeholders in that text, such as `{ "max": 4000 }` |

`message` is the English text. The widget looks `key` up in the bot's texts, overrides included, fills in `params`, and shows `message` when it has no text for the key.

`key` is absent in two cases:

- **Explained in development.** When `NODE_ENV` is `development`, as under `next dev`, a `bot_unavailable` error caused by the setup carries a description for you in `message` instead of a key: a missing or weak secret, a missing `OPENAI_API_KEY`, a key OpenAI rejects, a model the project can't use. The widget shows that description as it is. In production, the server never sends one.
- **Messages for developers.** Some refusals carry only a plain English `message`, such as `Expected an application/json body.`, `Malformed JSON.`, `Request body is too large.` and `Cross-origin requests are not allowed.`

Error responses outside the stream have the same fields, inside `error`:

```json
{
  "error": {
    "code": "invalid_input",
    "message": "Messages must be between 1 and 4000 characters.",
    "key": "error.messageLength",
    "params": { "max": 4000 }
  }
}
```

## HTTP status codes

| Status | Code | When |
| --- | --- | --- |
| `200` | | Success. For `POST /messages`, the stream has started, and later failures arrive as an `error` event |
| `204` | | `DELETE /conversation` succeeded, also when the conversation was already gone |
| `400` | `invalid_input` | The body is not what the endpoint expects (wrong `Content-Type`, malformed JSON, a JSON body over 256 KB), or the message, file or recording is refused, including when it is too large |
| `401` | `unauthorized` | The `Bearer` token is missing or invalid, or the request is cross-site |
| `401` | `session_expired` | The access token expired; renew it with `POST /session` and retry |
| `404` | `not_found` | An unknown path, bot or asset; a resume token that is invalid or belongs to someone else; a conversation that no longer exists |
| `429` | `rate_limited` | A rate limit was reached, the conversation reached `maxTurns`, or another dictation is still being transcribed |
| `429` | `budget_exceeded` | A daily token or speech budget is spent |
| `500` | `internal_error` | Unexpected server error |
| `502` | `upstream_error` | OpenAI failed or could not be reached |
| `503` | `bot_unavailable` | The kill switch (`ASKDARE_DISABLED=true`) is on, a secret or `OPENAI_API_KEY` is missing or invalid, or OpenAI refused the key or the model |
| `504` | `timeout` | OpenAI did not answer in time |

An error response with `retryAfterMs` also has a `Retry-After` header, in whole seconds rounded up. For `budget_exceeded`, it lasts until the next midnight UTC.

| Endpoint | Statuses |
| --- | --- |
| `GET /widget.js` | `200` |
| `GET /embed/<bot>`, `GET /theme/<bot>.css`, `GET /assets/<file>` | `200`, `404` |
| `POST /session` | `200`, `400`, `401`, `404`, `429`, `503` |
| `POST /messages` | `200`, `400`, `401`, `404`, `429`, `503` |
| `POST /history` | `200`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `DELETE /conversation` | `204`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /attachments`, `POST /transcriptions` | `200`, `400`, `401`, `404`, `429`, `502`, `503`, `504` |
| `POST /doctor` | `200`, `401`, `429`, `503` |

Any endpoint can also answer `500`.

## Protocol version

`PROTOCOL_VERSION`, exported from `@boldare/askdare`, is the version of this protocol: `1`. Every event stream (`POST /messages` answered with `200`) carries it in the `x-askdare-protocol` response header. Other responses don't have this header.

The widget compares the header with the version it was built with. On a mismatch, it doesn't read the stream and shows `error.updated` ("The assistant was updated. Please reload the page.").

## Client rules

- **Tolerate the unknown.** Ignore unknown event types and unknown fields. Newer servers may add them within the same protocol version.
- **Check the version.** Compare `x-askdare-protocol` with the version the client supports. On a mismatch, show a "please reload" state.
- **Run a watchdog.** If no bytes (events or comments) arrive for 45 s, abort and re-fetch the conversation history.
- **Render text safely.** Treat `text.delta` content as untrusted markdown and sanitize it before rendering.

## Versioning

- **Adding** an event type or an optional field is not breaking.
- **Removing or renaming** an event or field, or changing a field's meaning, is breaking. It bumps the protocol version and requires a minor release of `@boldare/askdare` (ADR-0006).
