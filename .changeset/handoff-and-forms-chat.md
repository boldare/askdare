---
'@boldare/askdare': minor
---

The widget, the chat inside a page and the headless React API show handoffs (ADR-0030) and forms (ADR-0031), with no code on your site.

- **Default look.** A "Talk to a person" button in the chat's header, for a bot with `handoff` and its button on, shown once there is an answer. Under the answer, "Connecting you with a person…" and then the outcome, or the handoff's form. A bot's forms render under the answer they belong to, with a visible label per field, optional fields marked, errors next to their fields, and the form's `done` text (or the handoff's outcome, naming the email address the visitor gave) once it is sent. Every text is plain text.
- **New primitives** in `@boldare/askdare/react`: `HandoffButton` (part `handoff`), `HandoffStatus` (part `handoff-status`, with `data-state`) and `Form` (parts `form`, `form-title`, `form-field`, `form-optional`, `form-error`, `form-submit` and `form-done`). `Form` checks the values by hand before sending, as the server does, ties each error to its field with `aria-describedby` and focuses the first; once sent, focus moves to its outcome.
- **Headless.** An answer's `handoff` holds where a handoff stands (`requested`, then `sent`, `saved`, `unavailable`, `failed` or `limited`), and its `forms` the forms shown under it, each `open`, `submitting`, `sent` or `expired`, with the server's error key per refused field; both come from the stream and from the history. `actions.handoff()` asks for a person from the latest answer, and `actions.submitForm(handle, values)` sends a form. `useChat().bot.forms` and `ChatConfig.forms` hold the bot's forms in the visitor's language and follow a language switch. The types `MessageForm`, `ChatForm`, `ChatFormField`, `ChatFormOption`, `FormFieldType`, `FormPurpose` and `HandoffState` are exported.
- **Texts** in every built-in language: `handoff.*`, `form.*` and `error.form.*`.
- **Accessibility.** axe runs on the new gallery states (`handoff`, `form`, `form-errors`) in every theme; `docs/accessibility.md` covers forms (WCAG 1.3.5, 3.3.1, 3.3.2, 3.3.3, 3.3.7).
