---
'@boldare/askdare-admin': minor
---

New package `@boldare/askdare-admin`: the admin dashboard (ADR-0032, stage 2), plugged into the admin console that `createChatHandler` serves. Pass `adminDashboard({ prices })` as the console's `dashboard`; after signing into the console, its owner sees cost per bot, day and model, ratings over time, new conversations, unanswered questions (a heuristic: answers without sources, withheld or failed), leads and handoffs per day with the resolution rate, the most expensive conversations, the 👎 answers with their comments, and a review of a conversation from its stored transcript.

`prices` are your own, per million input, cached input and output tokens, by model ID; a model without one shows its tokens and "no price". The package holds no price table or model ID, no route, sign-in, hooks or storage of its own: core writes the records to the admin store, checks access and serves the dashboard. Conversations reach the browser as sealed references, never their IDs, and transcripts and comments are shown as text. Its browser app is inlined at build time (8.6 KB gzipped, within a 12 KB budget).
