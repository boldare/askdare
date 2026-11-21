---
"@boldare/askdare": patch
---

Streamed answers stay smooth however long they get: `Markdown` now re-lexes and re-renders only the last blocks of a message on each delta, instead of the whole answer. Sanitizing is unchanged.
