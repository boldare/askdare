---
'@boldare/askdare-postgres': minor
---

New: `postgresConversations()`, a conversation store that keeps conversations in your own Postgres. Pass it to `createChatHandler({ conversations })`; turns then replay the stored history with `store: false`, so OpenAI keeps no copy of the conversation (only its abuse-monitoring logs of requests, which Zero Data Retention turns off; attached files are still uploaded to OpenAI). See [Own your data: what stays at OpenAI](https://github.com/boldare/askdare/blob/main/docs/own-your-data.md#what-stays-at-openai). It reads `DATABASE_URL` (or takes `url` or `pool`), connects on first use, and passes the same contract suite as the built-in stores.

- Run `npx askdare-postgres migrate` before deploying: it now creates the `askdare_conversations` and `askdare_conversation_items` tables. The store never changes the schema itself, and `askdare doctor` reports when it needs `migrate`.
- `sweep(idleSince, limit, signal?)` deletes conversations idle since a time and returns their IDs and attached file IDs, for a retention period you choose. Call it from a cron route (Vercel) or a scheduled job (Heroku); the README shows both.
