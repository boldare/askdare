---
'@boldare/askdare-postgres': minor
---

New: `postgresConversations()`, a conversation store that keeps conversations in your own Postgres. Pass it to `createChatHandler({ conversations })`; turns then replay the stored history with `store: false`, so nothing of the conversation stays at OpenAI. It reads `DATABASE_URL` (or takes `url` or `pool`), connects on first use, and passes the same contract suite as the built-in stores.

- Run `npx askdare-postgres migrate` before deploying: it now creates the `askdare_conversations` and `askdare_conversation_items` tables. The store never changes the schema itself, and `askdare doctor` reports when it needs `migrate`.
- `sweep(idleSince, limit)` deletes conversations idle since a time and returns their IDs and attached file IDs, for a retention period you choose. Call it from a cron route (Vercel) or a scheduled job (Heroku); the README shows both.
