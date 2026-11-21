---
'@boldare/askdare': patch
---

Server logs no longer risk carrying what a visitor wrote. When OpenAI rejects a request with a message that quotes the value it refused, or any other failure reaches the default error log (no `onError` set), quoted values longer than 32 characters are replaced, API keys are cut to their prefix and the message is capped at 300 characters. Status, error code, request ID and stack frames stay, so the logs remain useful for debugging.
