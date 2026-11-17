---
'@boldare/askdare': minor
---

A bot can give its texts per language: `widget.texts` also takes `{ en: {...}, pl: {...} }`, one set of overrides per language, so a chat with `locale: 'auto'` shows your own texts in each language (ADR-0014, step 2). A visitor gets the set for their language tag, else one for the same language; a language without a built-in dictionary gets the `en` set. The launcher on the page follows the same sets. A set's key wins over the `title`, `greeting`, `placeholder` and `launcherLabel` shortcuts for its language. The flat form is unchanged and still applies in every language. The chat document's `lang` follows a set written for the visitor's language.
