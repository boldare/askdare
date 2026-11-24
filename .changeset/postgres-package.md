---
'@boldare/askdare-postgres': minor
---

New add-on, `@boldare/askdare-postgres`, for keeping askdare's data in your own Postgres. This first release holds the schema machinery only: `migrate()` and the `askdare-postgres migrate` command create or upgrade the schema from `DATABASE_URL` (or a `url` or `pool` you pass), idempotently and never at request time. The conversation store and the pgvector knowledge index follow in later 0.6 releases.
