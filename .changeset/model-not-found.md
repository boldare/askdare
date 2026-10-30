---
"@boldare/askdare": patch
---

Tell a misconfigured model (`404 model_not_found` → `bot_unavailable`) apart from a deleted conversation (`404` → `not_found`), so the widget only resets the conversation when it is really gone.
