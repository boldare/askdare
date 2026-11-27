---
'@boldare/askdare': minor
---

Adds the `AdminStore` port (ADR-0032), the storage the admin console and `@boldare/askdare-admin` read from: per-turn usage, ratings, optional transcripts, and daily counts of handoffs and leads (counts only, never their values), with fixed queries bounded by a day range of at most 400 days and pages of at most 100. `deleteConversation` removes a conversation's records and keeps the daily totals; `sweep` removes old records and old daily rows. Each record write gets `AdminWriteOptions`: the app's `admin.retentionDays` and a `signal`, so retention is set in one place and a store that expires records on its own never does it sooner. `memoryAdminStore()` keeps them in memory for tests and warns in production. Store authors run `adminStoreContract` from `@boldare/askdare/testing`. The `AdminDashboard` type is how the dashboard add-on plugs into the console.

Nothing writes to the store yet: the `admin` option of `createChatHandler` comes in a later 0.7 change.
