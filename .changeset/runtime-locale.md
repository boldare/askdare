---
'@boldare/askdare': minor
---

The chat can switch language without a page load (ADR-0014, step 1). On a page with a bot set to `locale: 'auto'`, `askdare('configure', { locale: 'pl' })` or `data-follow-lang` on the script tag (which follows the page's `<html lang>`) switches the launcher's texts at once and reloads the chat in the new language. The visitor keeps their conversation; new answers follow the new language, as `context.locale` in your `instructions`. An answer still streaming during the switch is reported as `message.received` with `outcome: 'stopped'`, and the server still finishes and stores it. A bot with a fixed locale ignores the switch and says so once in the console. A `configure` call with only `locale` keeps the greeting, starters and context set before. In React, pass the new `locale` to `getChatConfig` as before.
