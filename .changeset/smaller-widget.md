---
"@boldare/chatdock": patch
---

The chat a visitor downloads shrank from 174 KB to 34 KB gzipped: it now runs on Preact inside its iframe, renders markdown from marked's tokens (still never as HTML), and checks protocol events without zod in the browser. Nothing changes for sites. The build now fails when the loader, the chat or its styles grow past their budgets.
