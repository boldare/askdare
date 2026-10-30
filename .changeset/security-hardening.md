---
"@boldare/askdare": minor
---

Security hardening after review: token budgets are reserved atomically before each turn (aborted turns stay charged), with new per-IP daily budgets, an optional `limits.globalDailyTokens`, and per-IP limits on new conversations. The in-memory store never evicts budgets, client IPs are validated with IPv6 grouped by /64, request bodies are capped while streaming, and the embed page sets `Cross-Origin-Opener-Policy`. `allowedOrigins` must be https (http only for localhost). Breaking: `BotContext.pageUrl` and the `pageUrl` request field were removed.
