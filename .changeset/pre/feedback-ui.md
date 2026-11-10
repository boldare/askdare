---
'@boldare/askdare': minor
---

The chat shows 👍 and 👎 under each answer when `createChatHandler` has `onFeedback`. After a 👎 it asks "What went wrong?" with an optional comment, a second click takes a rating back, and the browser remembers the visitor's ratings across reloads. New text keys `feedback.*` (English and Polish) and parts `feedback`, `feedback-button`, `feedback-comment` and its children. In your own React markup, use `FeedbackButton` and `actions.rate`. See the new Answer ratings guide.
