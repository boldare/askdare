---
'@boldare/askdare': minor
---

The chat switches its language in place (ADR-0014, step 2). When the page calls `askdare('configure', { locale })` or follows `<html lang>` with `data-follow-lang`, the chat no longer reloads: it fetches its texts for the new language from `GET <basePath>/config/<bot>` and keeps the conversation, the unsent message and an answer still streaming, which now finishes instead of being reported as `stopped`. New answers follow the new language. If the texts can't be loaded, the chat reloads as before. In React, a `Root` whose config changes only its `locale` switches the same chat instead of starting another one. `GET /config/<bot>` also answers `Content-Language`, the language its texts are written in.
