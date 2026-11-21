---
'@boldare/askdare': patch
---

Bots with `replies: 'suggest'` no longer write their answer twice. Current models mark an answer written before the `suggest_replies` call as commentary, and askdare took that as an unfinished turn and asked the model again, which repeated the answer. Text followed only by reply options now ends the turn as the answer, and the history shows it once.
