---
"@boldare/askdare": patch
---

Token budgets now count input read from the prompt cache as a tenth of a token, close to what it costs. Before, `dailyTokens`, `dailyTokensPerIp` and `globalDailyTokens` charged it at full weight, so a long conversation ran out of the default per-IP budget after about 13 turns while costing cents. Everything else (other input, cache writes, output) still counts as whole tokens, and the estimate reserved before each model call is unchanged. `onUsage` still reports the raw token counts from OpenAI.

Budgets now last longer for conversations with a warm cache; the money ceiling in the cost guide still holds when you take 10 × the cached-input price into account. Nothing to change unless you sized your budgets for full-weight cached input.
