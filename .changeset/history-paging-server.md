---
'@boldare/askdare': minor
---

`POST /history` now pages back through a whole conversation instead of stopping at its latest 100 items (ADR-0024, decision 7). It answers one page of whole turns, newest page first, and a `before` cursor when older messages exist; sending that cursor back as `before` reads the page before. A turn is never split between pages, so each answer keeps its cards, its rating handle and, under output checks, its verdict. Only the latest page carries reply options. This works with `openaiConversations()` and with stores that keep the items, such as `postgresConversations()`.

The cursor is opaque and bound to its conversation: one from another conversation, forged or expired answers `400`. It is additive within protocol version 1: clients that send no cursor get the latest page, as before. The widget, the chat inside a page and the headless API load older pages as the visitor scrolls up.

Custom conversation stores: `page()` must return the same items for the same `before` and `limit`, honour a `limit` of up to 200, and keep `before` within 1,024 characters (see [Custom stores](https://github.com/boldare/askdare/blob/main/docs/custom-store.md)).
