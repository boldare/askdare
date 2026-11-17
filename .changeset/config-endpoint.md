---
'@boldare/askdare': minor
---

New route `GET <basePath>/config/<bot>?lang=<tag>`: the bot's public configuration in one language, built like the chat document's, so it never carries the model, instructions, tools or vector stores. It prepares switching the chat's language in place (ADR-0014, step 2). A bot with a fixed locale ignores `lang`, and an invalid tag answers `400` with `invalid_input`. Additive within protocol version 1.
