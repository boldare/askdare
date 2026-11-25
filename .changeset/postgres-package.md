---
'@boldare/askdare-postgres': minor
---

New add-on, `@boldare/askdare-postgres`, for keeping askdare's data in your own Postgres. `migrate()` and the `askdare-postgres migrate` command create or upgrade its schema from `DATABASE_URL` (or a `url` or `pool` you pass), idempotently and never at request time. It holds a conversation store (`postgresConversations`) and a pgvector knowledge index (`pgvectorIndex`). See [Own your data](https://github.com/boldare/askdare/blob/main/docs/own-your-data.md).
