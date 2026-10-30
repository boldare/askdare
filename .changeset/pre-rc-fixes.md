---
'@boldare/askdare': patch
---

Fixes found while writing the reference docs:

- When the server refuses a session (missing or weak `CHAT_SECRET`, the kill switch, `sessionsPerIpPerHour`), the chat shows the server's reason, explained in development, instead of "Connection problem".
- A message no longer reserves tokens when OpenAI isn't set up (for example without `OPENAI_API_KEY`), so failed attempts don't use up the budgets.
- Token budgets are reserved per model call. A bot with tools reserves the next call before each tool round, and answers without tools when a budget can't hold it. Under the default limits, a large PDF on a bot with tools no longer always ends in `budget_exceeded`, and each call's `maxOutputTokens` is reserved.
- A used-up speech budget says that only dictation is unavailable (new text key `error.dictationBudget`).
- The in-memory store drops expired counters, whose keys hold IP addresses, within a minute.
