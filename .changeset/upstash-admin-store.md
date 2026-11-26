---
'@boldare/askdare-upstash': minor
---

Adds `upstashAdminStore()`, the `AdminStore` (ADR-0032) for sites on Upstash Redis with no SQL database. Every dashboard query is answered from counters, sorted sets and summaries kept at write time, each write and read is one atomic script, and key names hold no conversation ID, visitor or content. Records are removed by the handlers' `sweep()` and, as a backstop, expire `retentionDays` (default 30) after a conversation's latest record; daily totals expire after 400 days. It passes `adminStoreContract`.
