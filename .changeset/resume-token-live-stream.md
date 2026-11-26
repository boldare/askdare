---
'@boldare/askdare': patch
---

A visitor who signs in or out while an answer streams keeps the conversation the sign-in or sign-out gave them: the chat no longer stores the resume token the answer's stream ends with, which was issued for the previous identity, in the new one's place. Together with the 0.6.x fix to `POST /resume`, an anonymous resume token no longer outlives the sign-in on that browser.
