---
'@boldare/askdare': patch
---

A conversation that outgrows the model's context window now ends with "This conversation is too long. Please start a new one." (`invalid_input`, key `error.conversationTooLong`) instead of a generic "temporarily unavailable" error, should OpenAI ever refuse it. askdare keeps sending the deprecated `truncation: 'auto'` until OpenAI announces a shutdown date, so long conversations keep working as before.
