---
'@boldare/askdare': patch
---

`POST /history` gives a rating handle only to the answers the stream rated: each turn's final answer, and not one that `onOutput` replaced. A replaced answer could be rated after a reload, though not while it streamed.
