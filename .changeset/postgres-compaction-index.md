---
'@boldare/askdare-postgres': patch
---

`migrate` adds a partial index on compaction items (conversations schema version 2), so `context()` finds a conversation's latest compaction item without reading all its items. Run `npx askdare-postgres migrate` when you upgrade: until then `doctor` reports the schema as behind, and the store keeps working without the index. The build blocks appends for about a tenth of a second per million items; on a very large table, build it beforehand with `create index concurrently` ([custom stores](https://askdare.vercel.app/docs/custom-store#the-compaction-lookup)).
