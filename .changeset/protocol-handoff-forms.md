---
'@boldare/askdare': minor
---

The wire protocol describes handoff to a person and forms in the chat, additively in version 1 ([protocol](https://askdare.vercel.app/docs/protocol#handoff)): the `handoff` and `form` events, `handoff` and `forms` on answers in `POST /history`, the request and answer of `POST /handoff` and `POST /forms`, and the `forms` of a bot's public configuration. Nothing sends them yet; the server and the chat follow in later 0.7 changes. Clients from 0.6 ignore the new events and fields.
