---
"@boldare/chatdock": minor
---

Add rate limits and a daily token budget per bot: sessions per IP, messages per visitor and per IP, turns per conversation, and `CHATDOCK_DISABLED=true` as a kill switch. Limits answer `429` with `Retry-After`. Counters live in memory by default; pass `limits: { store }` to share them across instances, and `limits: { trustProxy }` to read the client IP correctly behind your proxy.
