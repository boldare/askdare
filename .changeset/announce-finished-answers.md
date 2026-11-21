---
'@boldare/askdare': patch
---

Screen readers now hear a finished answer once, as its rendered text. The conversation (`Messages`) is still a `log` but no longer a live region, since text growing inside a message was read in fragments or not at all; a visually hidden `status` next to it (`data-ask-part="announcement"`) announces each answer when it ends. Answers restored after a reload aren't read out. New guide, `docs/accessibility.md`: the dated WCAG 2.2 AA conformance statement, with its scope, method, manual review and known limitations.
