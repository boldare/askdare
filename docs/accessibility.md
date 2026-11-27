# Accessibility

This is askdare's accessibility conformance statement. It says what the widget and its default look aim for, how that was checked, and what is known not to work yet. Why askdare cares, and what the European Accessibility Act asks of your site, is in [Compliance](compliance.md#5-accessibility).

**Last reviewed: 2026-11-26**, against 0.7 (handoff to a person and forms). The statement is updated whenever the chat's markup changes.

## Status

askdare targets [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA, the level that [ETSI EN 301 549 V4.1.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf) asks for web content.

- **Automated checks:** no failures (axe-core, every built-in theme and state, five browser setups including Safari's engine on an iPhone viewport).
- **Manual review of the WCAG 2.2 criteria axe can't check:** no failures in the chat. One known limitation, with a fix for full-screen chats; see [2.4.11](#manual-review).
- **Screen readers:** not tested by hand. askdare doesn't run manual checks with VoiceOver or NVDA; the tests check what screen readers rely on instead (roles, names, live regions, and the finished answer announced once).

With the known limitations below and no screen-reader testing, the status is **partially conformant**.

## Scope

What this statement covers:

- the launcher and the chat in its iframe, as `widget.js` adds them to a page;
- the default look (`DefaultChat`, `DefaultPanel`) in all four built-in themes (Halo, Aura, Sage, Care), light and dark;
- the same look inside your page with `@boldare/askdare/react` ([React](react.md));
- the built-in texts in every built-in language ([Texts](texts.md)).

What it doesn't cover, so it is yours to check:

- **Your page around the chat**, including where you put the launcher and on which pages.
- **Your own markup**: headless primitives, an ejected skin (`add ui`), your own components in `components`, and tool cards from `toolRenderers`. The primitives keep their roles, names and live regions; how you lay them out and style them is up to you.
- **Your theme and CSS**: a custom theme's colors, `widget.css`, and `::part()` rules. In development, askdare warns when a theme's colors miss AA contrast.
- **Your forms' wording and fields** (`defineForm`): their titles, labels and options, and fields whose purpose askdare can't tell from their type or name (see 1.3.5 below).
- **What the model writes.** Answers are rendered from Markdown into real headings, lists, tables and links, but their wording, heading order, link text and language come from the model and your instructions.
- The askdare website.

## Method

### Automated, on every change

- **axe-core** (4.14, through `@axe-core/playwright`) with the rules tagged `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`. Selecting by tag also runs the rules axe leaves off by default, such as `target-size` (2.5.8). It runs on:
  - every built-in theme in both schemes, in every state of the gallery: welcome, conversation, streaming, attachments, error, dictation, rating, reply options under the answer and above the message field, a handoff's outcome with the "Talk to a person" button, and a form, open and refused by the server;
  - the launcher on a third-party page, and the open chat after a real answer;
  - the chat inside a page.
- **Browsers:** Chromium, Firefox and WebKit on a desktop viewport, and Chromium emulating a phone (Pixel 7: a 412 px wide touch screen).
- **Contrast:** axe can't measure text over the themes' gradients (it reports those as "needs review"), so unit tests check every built-in theme's colors instead: AA for all, and AAA for text in Care.
- **Behaviour tests:**
  - a finished answer is announced once, as rendered text, and not while it streams;
  - a restored conversation is not read out;
  - loading earlier messages keeps the visitor's place, is announced, and keeps focus on the button or gives it to the oldest message;
  - no control is covered by the rest of the chat when it has focus (2.4.11), the fields of a form included;
  - a form's errors are tied to their fields (`aria-describedby`, `aria-invalid`), the first field with an error gets focus, a failure of the whole form is an `alert`, and once the form is sent focus moves to what replaced it;
  - focus doesn't go behind a full-screen chat (2.4.11);
  - Escape closes the chat and returns focus to what opened it.

### Manual review

The WCAG 2.2 criteria that automated tools can't decide were reviewed by hand on 2026-11-21, against the markup and behaviour of the chat:

| Criterion | Result | What was checked |
| --- | --- | --- |
| 2.4.11 Focus Not Obscured (Minimum) | Passes in the chat; one limitation on the page | Inside the chat, the header and the message field sit outside the scrolling message list, so they never cover what has focus (also a test). A chat that fills the screen (on a phone, or a desktop page zoomed to 400%) keeps focus inside it until it is closed. On a wider screen, the open chat floats over a corner of your page and isn't modal: see [Known limitations](#known-limitations). |
| 2.5.7 Dragging Movements | Passes | Nothing needs dragging. Files can be dropped onto the chat, and the attach button does the same with a single click or tap. |
| 2.5.8 Target Size (Minimum) | Passes | axe's `target-size` rule in every state and on a phone. The launcher is at least 56 by 56 px. |
| 3.2.6 Consistent Help | Passes for the chat; the rest is your site's | The launcher sits in the same corner of every page that loads `widget.js`, and the chat is the same on each. Which pages load it, and any `::part(launcher)` rule that moves it, are your choice: to meet 3.2.6 on your site, keep it in the same place on every page that has it. |
| 1.3.5 Identify Input Purpose | Passes for the fields askdare can know | A form's email and phone fields have `autocomplete="email"` and `"tel"`, and text fields named `name`, `company` or `organization` get `name` or `organization`. Any other field's purpose is the bot owner's wording, so it has `autocomplete="off"`; name your fields as above to have them filled. Reviewed against the markup on 2026-11-26. |
| 3.3.1 Error Identification, 3.3.3 Error Suggestion | Passes | Every refused field says what is wrong in text next to it ("Enter a valid email address.", "Use at most 200 characters."), tied to the field, which also has `aria-invalid`. Reviewed on 2026-11-26. |
| 3.3.2 Labels or Instructions | Passes | Every field of a form has a visible label, optional fields say "(optional)", and a `select` starts with "Choose…". The form is named by its visible title. Reviewed on 2026-11-26. |
| 3.3.7 Redundant Entry | Passes | A form never asks again for what the visitor gave in it: a refused form keeps its values, and a sent form is replaced by its outcome. Reviewed on 2026-11-26. |
| 3.3.8 Accessible Authentication (Minimum) | Passes | The chat asks for no password or code. Signed-in visitors are identified by your backend, without anything for them to type. The optional human check (Cloudflare Turnstile) is not a puzzle: it usually passes without interaction, and at most asks for one click on a checkbox. |

## How the chat works with assistive technology

- **The conversation** is a `log`, but not a live region: text that grows inside a message is read in fragments or not at all, so the chat doesn't rely on it. When an answer finishes, its rendered text is announced **once** through a separate, visually hidden `status` region. Answers restored after a reload are not read out.
- **Long conversations** load older messages a page at a time, from a "Show earlier messages" button at the top of the conversation, which also loads when the visitor scrolls up to it. The messages go in above without moving what the visitor was reading, and the hidden `status` region says "Earlier messages loaded." From the keyboard, focus stays on the button, in view, with the older messages under it; once the start of the conversation is reached and the button goes away, focus moves to the oldest message.
- **What the assistant is doing** (loading, thinking, searching, using a tool) is a polite `status`. **Errors** are an `alert`.
- **Talk to a person:** the button sits in the chat's header. While the request runs it stays focused, with `aria-disabled`. Under the answer, a polite `status` says "Connecting you with a person…" and then, in the same region, the outcome, so it is announced.
- **Forms** under an answer are named by their title, every field has a visible label, and optional fields say so. Sending checks the values first: each error is text tied to its field, and the first field with an error gets focus. When the form is sent, it is replaced by a `status` with the outcome, which gets focus, since the button that was focused is gone.
- **The panel** is a labelled `region`, or `main` when the chat is the whole page. The launcher says whether the chat is open (`aria-expanded`), and its name starts with its visible label.
- **Keyboard:** everything works with the keyboard. Enter sends and Shift+Enter starts a new line. Escape dismisses the "Start over" question if it is open, else cancels a dictation, else closes the chat. Closing returns focus to whatever opened the chat. "Start over" asks in a dialog, and focus comes back to its button.
- **Motion:** the chat follows `prefers-reduced-motion`: no entrance animations, and the launcher and panel open and close without movement.
- **Zoom and reflow:** the widget's chat fills the screen at 480 CSS pixels and narrower, which covers phones and a desktop page zoomed to 400%.

## Known limitations

- **Screen readers aren't tested by hand.** Problems found with VoiceOver, NVDA or TalkBack are fixed as bugs; please report them.
- **On a wide screen, the open chat floats over your page.** It is a non-modal dialog in a corner. If a visitor tabs out of it into your page, the element that gets focus may sit behind the chat (2.4.11). Escape closes it while focus is in the chat, and the launcher closes it from the page. A chat that fills the screen doesn't have this problem, since focus stays in it.
- **The launcher can cover your page's content.** It is fixed to a corner of the window, so an element of your page that scrolls under it can be partly hidden when it gets focus. Leave room for it at the bottom of your page, or move it with `::part(launcher)` ([Styling](styling.md)). The [greeting next to the launcher](embedding.md#a-greeting-and-an-unread-badge), when a bot has one, covers a little more of that corner until the visitor dismisses it (× or Escape).
- **The finished answer is announced in full.** A long answer is long to listen to; a screen reader's own "stop speaking" key interrupts it. Its copy stays in the hidden region until the next answer or until earlier messages load, so reading the whole page in order meets the latest answer twice.
- **Answers in another language** than the chat's are not marked with their own `lang`, so a screen reader may read them with the wrong voice (3.1.2).
- **Dictation needs a microphone.** Typing always works instead.

## Feedback

Found an accessibility problem? Please [open an issue](https://github.com/boldare/askdare/issues) with the browser, the assistive technology and what happened. Problems that block a visitor are fixed first.
