---
'@boldare/askdare': patch
---

An answer shows one form at most, a handoff's contact form included: when the model calls `handoff` and `show_form` in the same answer, the handoff's form is shown and `show_form` is refused, instead of drawing two forms under one answer. The admin console's configuration view now shows each bot's handoff settings (whether the model and the button can ask, its form, whether an availability check is set, `content` and limits), its forms (names, whether the model may show them, and each field's type, `required` and `toModel`) and the launcher greeting's delay.
