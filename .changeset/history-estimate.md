---
"@boldare/askdare": patch
---

The token budget reserved before each model call now counts a conversation's history once. Before, after a message in which the bot called tools, the next message reserved the input of all its model calls, about three times the history after one with three calls, so long conversations with tool-using bots ran out of `dailyTokensPerIp` a few turns early. Real usage still replaces the reservation when the message ends, and `onUsage` still reports the summed counts. Nothing to change.
