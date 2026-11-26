---
'@boldare/askdare': minor
---

`defineForm` declares a form a bot can show in the chat (ADR-0031), from a closed set of fields: `text`, `email`, `phone`, `select`, `textarea` and `consent`. Labels, titles, `submit` and `done` take a string or a map by language. The form is checked at startup (names, at most 8 fields, lengths of texts and values, 2 to 10 options) and throws with every reason. Its `description` is for the model only, and `model: false` keeps a form for a handoff. Each field's `toModel` is off by default, so the model learns only that the form was sent. Bots can't use forms yet: `defineBot({ forms })` and `onLead` come in a later 0.7 change.
