---
'@boldare/askdare': minor
---

The chat can show clickable reply options under the latest answer ("Yes, book it", "Show prices"), in the widget and inside a page. A click sends the option as the visitor's own message. This release adds the groundwork: a `replies` protocol event (additive in protocol version 1) with `replies` on the latest answer in the history, `ChatMessage.replies`, the `QuickReplies` primitive with the `replies` and `reply` parts, the `message.replies` text, and `source: 'reply'` on the `message.sent` chat event. Options are plain text: at most four, up to 80 characters each, without links. Model-suggested and tool-defined options, which fill them, come in later releases (ADR-0015).
