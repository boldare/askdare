# Styling and customization

Three levels, each with more freedom than the last ([ADR-0008](adr/0008-ui-customization-and-themes.md)). Streaming, security and limits stay in the library whatever you change.

| Level | How | For |
| --- | --- | --- |
| 1. Configuration | `widget: { … }` in `defineBot` | Texts, language, theme, suggestions, avatar, disclosure |
| 2. Your own CSS | `widget.css`, plus `::part()` for the launcher | Any look, on top of the parts and tokens below |
| 3. Page JavaScript | `chatdock(…)` and attributes on the script tag | Your own button, the chat inside your page, per-page texts and context |

## 1. Configuration

```ts
defineBot({
  // …
  widget: {
    title: 'Brightloop assistant',
    subtitle: 'Answers from our help center',
    greeting: 'Hi! How can I help?',
    starters: ['What does the Business plan include?'],
    avatar: '/assistant.png',
    locale: 'auto', // the page's language, else the visitor's browser
    texts: { 'composer.placeholder': 'Ask about plans, support or security…' },
    disclosure: { privacyUrl: 'https://www.example.com/privacy' },
    theme: 'halo', // see docs/themes.md
    colorScheme: 'auto',
  },
});
```

- **Language.** Texts ship in English and Polish. `locale: 'auto'` follows the `lang` of the page that embeds the chat, else the visitor's browser; any other language shows English unless you set `texts`. The locale is also the default answer language.
- **Texts.** Every text has a key; `texts` overrides any of them. `title`, `greeting`, `placeholder` and `launcherLabel` are shortcuts for `header.title`, `welcome.greeting`, `composer.placeholder` and `launcher.label`, and a configured text is used in every language. The full list is in [`src/i18n/texts.ts`](../packages/chatdock/src/i18n/texts.ts); the keys are public API. Plural keys end in `.one`, `.few`, `.many` or `.other`.
- **Disclosure.** By default the chat says, under the message field, that the visitor is talking to an AI (EU AI Act, art. 50). Add `privacyUrl` for a link to your privacy policy. `disclosure: false` hides it; only do that when your page already says so.

## 2. Your own CSS

```ts
widget: {
  css: `
    [data-cd-part="bubble"] { border-radius: 6px; }
    [data-cd-part="message"][data-role="user"] [data-cd-part="bubble"] { font-weight: 500; }
    :root { --cd-color-accent: #0f766e; }
  `,
}
```

Your CSS loads after the theme. The library's styles are in `@layer chatdock`, so yours wins without `!important`. The chat's Content Security Policy still applies: images and fonts load only from your app.

**Tokens:** the `--cd-*` variables listed in [Themes](themes.md#tokens).

**Parts** (`[data-cd-part="…"]`, public API): `panel`, `header`, `identity`, `title`, `subtitle`, `actions`, `new-conversation`, `close`, `avatar`, `orb`, `messages`, `welcome`, `greeting`, `starters`, `starter`, `persona`, `persona-name`, `presence`, `intro`, `intro-card`, `message`, `message-body`, `bubble`, `typing`, `citations`, `citation`, `attachments-note`, `status`, `error`, `composer`, `composer-box`, `input`, `attach`, `voice`, `send`, `attachments`, `message-attachments`, `attachment`, `attachment-preview`, `attachment-badge`, `attachment-name`, `attachment-status`, `attachment-remove`, `recorder`, `recorder-level`, `recorder-label`, `recorder-time`, `recorder-cancel`, `recorder-done`, `disclosure`.

**States:** `message[data-role="user|assistant"]`, `message[data-status="streaming|done|error"]`, `attachment[data-status="uploading|ready|error"]`, `recorder[data-state="recording|transcribing"]`, `panel[data-busy]` while the assistant works, `avatar[data-kind="orb|icon|initials|image"]`, `welcome[data-layout="hero|persona|intro"]`.

**Variants** of the theme are attributes on `<html>`: `data-cd-preset`, `data-cd-scheme`, `data-cd-avatar`, `data-cd-welcome`, `data-cd-launcher`, `data-cd-bubbles`, `data-cd-surface`, `data-cd-density`, `data-cd-composer`.

**The launcher** lives in a shadow root on your page. Style it from your own CSS with `::part`:

```css
[data-chatdock]::part(launcher) { right: 32px; bottom: 32px; }
[data-chatdock]::part(panel) { border-radius: 8px; }
```

## 3. Page JavaScript

```html
<!-- Your own button instead of the launcher -->
<button onclick="chatdock('open')">Chat with us</button>
<script src="https://app.example.com/api/chat/widget.js?bot=support" data-launcher="none" async></script>

<!-- The chat inside your page -->
<div id="chat" style="height: 600px"></div>
<script src="https://app.example.com/api/chat/widget.js?bot=support" data-mode="inline" data-target="#chat" async></script>
```

| Call | Effect |
| --- | --- |
| `chatdock('open')`, `chatdock('close')`, `chatdock('toggle')` | Shows or hides the chat. Closing returns focus to whatever opened it. |
| `chatdock('configure', { greeting, starters, context })` | Per-page greeting and suggestions, and `context`: a short description of the page (up to 1000 characters) for the assistant. |

`configure` accepts only those three fields: never the model, instructions or tools. The context reaches the model as clearly marked information about the page, never as instructions, and anyone can set it from their browser, so treat it like something the visitor typed. Call it after the script has loaded:

```js
document.querySelector('script[src*="widget.js"]').addEventListener('load', () => {
  chatdock('configure', {
    greeting: 'Questions about our prices?',
    starters: ['How much is the Business plan?'],
    context: 'Pricing page listing the Free, Team and Business plans.',
  });
});
```

## Accessibility

Accessibility is not configurable away. The focus ring is always visible, motion follows `prefers-reduced-motion`, the chat is a labelled dialog, and Escape closes it (or cancels a dictation). Every preset passes axe in every state, and its colors pass WCAG AA (AAA for text in Care); a customized theme with weak contrast triggers a warning in development.
