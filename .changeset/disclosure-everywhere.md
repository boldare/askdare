---
'@boldare/askdare': minor
---

New `Disclosure` primitive in `@boldare/askdare/react`: the AI notice (EU AI Act, art. 50) for your own markup and for your own page in the widget's iframe. It shows `disclosure.text` with the `widget.disclosure.privacyUrl` link, takes children to replace the text, and renders nothing with `disclosure: false`. The default look now uses it, with the same markup as before.

In development, `Root` and `EmbedRoot` note once in the console when the chat rendered without a `Disclosure` while the bot keeps the notice on; `widget.disclosure: false` silences it. `askdare doctor` lists bots with `disclosure: false` as information, not a failure. Nothing changes for existing bots.
