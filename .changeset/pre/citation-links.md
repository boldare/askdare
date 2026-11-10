---
'@boldare/askdare': patch
---

Source links under an answer are checked like links inside it: only `http`, `https` and `mailto` URLs become links, and anything else shows as plain text. Before, they relied on the protocol validator alone.
