---
'@boldare/askdare': minor
---

Visitors' ratings of answers reach `createChatHandler({ onFeedback })`: 👍, 👎 with an optional comment, or the rating taken back, with the conversation and answer IDs for your own review. Each answer carries an encrypted rating handle in `message.end` and in the history, bound to the visitor or signed-in user, and `POST /feedback` accepts a rating only from them. A bot turns ratings off with `widget.feedback: false`. askdare stores no ratings.
