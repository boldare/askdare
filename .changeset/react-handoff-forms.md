---
'@boldare/askdare': minor
---

Shows handoff to a person (ADR-0030) and forms (ADR-0031) in the widget, the chat inside a page and the headless React API.

- **Default look.** "Talk to a person" in the chat's header, for a bot with `handoff` and its button on, shown once there is an answer. Under the answer, "Connecting you with a person…" and then the outcome, or the handoff's form. A bot's forms render under the answer they belong to, with a visible label per field, optional fields marked, errors next to their fields, and the form's `done` text (or the handoff's outcome, naming the email address the visitor gave) once it is sent. Every text is plain text.
- **New primitives** in `@boldare/askdare/react`: `HandoffButton` (part `handoff`), `HandoffStatus` (part `handoff-status`, with `data-state`) and `Form` (parts `form`, `form-title`, `form-field`, `form-optional`, `form-error`, `form-submit` and `form-done`). `Form` checks the values by hand before sending, as the server does, ties each error to its field with `aria-describedby` and focuses the first; once sent, focus moves to its outcome.
- **Headless.** `useChat().bot.forms` has the bot's forms, and the types `MessageForm`, `ChatForm`, `ChatFormField`, `ChatFormOption`, `FormFieldType`, `FormPurpose` and `HandoffState` are exported. The public configuration (`GET /config/<bot>` and the chat document) gets `handoff: true` when the bot shows the button, and nothing else of its handoff settings: additive in protocol version 1, documented in `docs/protocol.md`.
- **Texts** in every built-in language: `handoff.*`, `form.*` and `error.form.*`, plus `launcher.greeting`, `launcher.dismiss` and `launcher.unread` for the launcher's greeting and unread badge (ADR-0033), which the launcher starts using in a later change.
- **Accessibility.** axe runs on the new gallery states (`handoff`, `form`, `form-errors`) in every theme; `docs/accessibility.md` covers forms (WCAG 1.3.5, 3.3.1, 3.3.2, 3.3.3, 3.3.7).
