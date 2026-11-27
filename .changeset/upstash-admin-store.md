---
'@boldare/askdare-upstash': minor
---

Adds `upstashAdminStore()`, the `AdminStore` (ADR-0032) for sites on Upstash Redis with no SQL database. Every dashboard query is answered from counters, sorted sets and summaries kept at write time, each write and read is one atomic script, and key names hold no conversation ID, visitor or content. Records are removed by the handlers' `sweep()` and, as a backstop, expire `admin.retentionDays` after a conversation's latest record (askdare passes it with every write; the store has no retention setting of its own); daily totals expire after 400 days. It passes `adminStoreContract`.
