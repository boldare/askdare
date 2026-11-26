---
'@boldare/askdare': patch
---

`POST /resume` hands out a resume token for the session that resumes, in place of the one the answer logged. A visitor who signed in while an answer streamed, and whose stream then dropped, no longer gets the anonymous token back, which would have kept the conversation readable on that browser after sign-out.
