---
'@boldare/askdare': patch
---

`askdare doctor` now keeps its 10-second limit for the OpenAI conversation store check: a request that hangs ends with "The OpenAI API did not answer in time", instead of waiting for the OpenAI client's own 20-second timeout.
