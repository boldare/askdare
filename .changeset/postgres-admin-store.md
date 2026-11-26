---
'@boldare/askdare-postgres': minor
---

`postgresAdminStore()` keeps the admin console's records in your Postgres (ADR-0032): usage per turn, ratings, transcripts and daily counters per bot and model, with indexes for every dashboard query. `migrate` adds its tables as a new `admin` schema part; run `npx askdare-postgres migrate` when you upgrade (a database without pgvector: `migrate conversations admin`). On one `DATABASE_URL` it shares the pool of `postgresConversations()`.
