---
'@boldare/askdare': minor
---

Two handoff transports in `@boldare/askdare/next` (ADR-0030), ready for the coming `onHandoff` option of `createChatHandler`:

- `webhookHandoff({ url, secret, timeoutMs?, headers? })` posts the `ChatHandoffReport` as JSON, signed with Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) so any Standard Webhooks verifier accepts it. It sends over https only (plain http just for localhost outside production), follows no redirects, gives each attempt 4 seconds by default and retries a network error, timeout, `408`, `429` or `5xx` once after 500 ms, within the ten seconds a handoff has.
- `emailHandoff({ to, from, send })` formats the report as a plain-text email and passes it to your own `send` function (Resend, Postmark, SES, nodemailer…). The visitor's email becomes `replyTo`; the subject holds only fixed text, the bot and the reason.

Both throw when the request was not delivered, and their errors never quote the report or the receiver's answer.
