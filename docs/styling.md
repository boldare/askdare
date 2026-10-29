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
    theme: 'aura', // see docs/themes.md
    colorScheme: 'auto',
  },
});
```

- **Language.** Texts ship in English and Polish. `locale: 'auto'` follows the `lang` of the page that embeds the chat, else the visitor's browser; any other language shows English unless you set `texts`. The locale is also the default answer language.
- **Bold words.** In a greeting, `**words**` are shown in bold. Aura uses this for its two-weight headline.
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

**Parts** (`[data-cd-part="…"]`, public API): `panel`, `header`, `identity`, `title`, `subtitle`, `actions`, `new-conversation`, `close`, `avatar`, `orb`, `messages`, `welcome`, `greeting`, `starters`, `starter`, `persona`, `persona-name`, `presence`, `intro`, `intro-card`, `message`, `message-body`, `bubble`, `typing`, `citations`, `citation`, `attachments-note`, `status`, `error`, `composer`, `composer-box`, `input`, `attach`, `voice`, `send`, `attachments`, `message-attachments`, `attachment`, `attachment-preview`, `attachment-badge`, `attachment-name`, `attachment-status`, `attachment-remove`, `recorder`, `recorder-level`, `recorder-label`, `recorder-time`, `recorder-cancel`, `recorder-done`, `send-label` (shown by Aura), `disclosure`.

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

`configure` accepts only those three fields: never the model, instructions or tools. The context is off unless the bot opts in with `pageContext: true` in `defineBot`. It then travels with the visitor's message, as a marked part of their own turn: anyone can set it from their browser, so it gets no more trust than what the visitor types, and it never becomes part of the bot's instructions. It is sent again only when it changes, and the visitor's history doesn't show it. Define the small queue first, then call it any time:

```html
<script>
  // Safe to call before the script has loaded: calls queue up and run once it is ready.
  window.chatdock = window.chatdock || function () {
    (window.chatdock.q = window.chatdock.q || []).push(arguments);
  };
  chatdock('configure', {
    greeting: 'Questions about our prices?',
    starters: ['How much is the Business plan?'],
    context: 'Pricing page listing the Free, Team and Business plans.',
  });
</script>
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

An inline chat loads with the page without taking focus or scrolling to itself.

In a React app, Next.js included, add the script after hydration, for example from a `useEffect` in a small client component. The loader adds the chat inside your element, and React must not find it there while it hydrates. The starter's [`chat-script.tsx`](../examples/starter/app/chat-script.tsx) does this. The chat loads once per page load and lives as long as its element: put the element in a layout that stays, or link to the page with full page loads, because a client-side navigation away and back leaves the element empty.

## Accessibility

Accessibility is not configurable away. The focus ring is always visible, motion follows `prefers-reduced-motion`, the chat is a labelled dialog, and Escape closes it (or cancels a dictation). Every preset passes axe in every state, and its colors pass WCAG AA (AAA for text in Care); a customized theme with weak contrast triggers a warning in development.
