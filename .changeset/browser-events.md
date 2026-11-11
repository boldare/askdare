---
'@boldare/askdare': minor
---

The page can now hear what happens in the chat, for analytics such as GA4 or a GTM `dataLayer`: `askdare('on', type, listener)` with the script tag, or `onEvent` on `Root` in React. Events cover the chat opening and closing, messages sent, answers received, ratings, errors and starting over. They carry metadata only, such as counts, durations and outcomes, and never message text. See "Events in the browser" in the observability docs (ADR-0013).
