---
"@boldare/askdare": patch
---

A turn now finishes even if the visitor disconnects once the model call has started, so it is charged its real token usage instead of the advance estimate, and the answer is waiting in the conversation when the visitor comes back. If the visitor leaves before any OpenAI call, nothing is called; a new conversation whose handle never reached them is deleted. On Vercel the Next.js adapter keeps the function alive with `after()`, which adds `next` as an optional peer dependency.
