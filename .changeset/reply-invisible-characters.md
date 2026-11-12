---
'@boldare/askdare': patch
---

Reply options with characters the visitor can't see are dropped: zero-width and tag characters, direction marks, private-use and unassigned code points. A click sends an option as the visitor's own message, so it now always says exactly what they read. Emoji built with the zero-width joiner still work.
