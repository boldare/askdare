# Styling and customization

Three levels, each with more freedom than the last ([ADR-0008](adr/0008-ui-customization-and-themes.md)). Streaming, security and limits stay in the library whatever you change.

| Level | How | For |
| --- | --- | --- |
| 1. Configuration | `widget: { … }` in `defineBot` | Texts, language, theme, suggestions, avatar, disclosure |
| 2. Your own CSS | `widget.css`, plus `::part()` for the launcher | Any look, on top of the parts and tokens below |
| 3. Page JavaScript | `askdare(…)` and attributes on the script tag | Your own button, the chat inside your page, per-page texts and context |

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
- **Texts.** Every text has a key; `texts` overrides any of them. `title`, `greeting`, `placeholder` and `launcherLabel` are shortcuts for `header.title`, `welcome.greeting`, `composer.placeholder` and `launcher.label`, and a configured text is used in every language. The full list, with plurals and how to add a language, is in [Texts](texts.md); the keys are public API.
- **Disclosure.** By default the chat says, under the message field, that the visitor is talking to an AI (EU AI Act, art. 50). Add `privacyUrl` for a link to your privacy policy. `disclosure: false` hides it; only do that when your page already says so.

## 2. Your own CSS

```ts
widget: {
  css: `
    [data-ask-part="bubble"] { border-radius: 6px; }
    [data-ask-part="message"][data-role="user"] [data-ask-part="bubble"] { font-weight: 500; }
    :root { --ask-color-accent: #0f766e; }
  `,
}
```

Your CSS loads after the theme. The library's styles are in `@layer askdare`, so yours wins without `!important`. The chat's Content Security Policy still applies: images load only from your app or as `data:` and `blob:` URLs, and fonts only from your app.

A full example is the demo site's BLDR theme, in Boldare's style: `defineTheme` over Halo for colors, type and square corners, a few lines of `widget.css` for the hard shadows and highlights, and `::part(launcher)` on the page for the button. The code is in [Themes: a theme in your brand](themes.md#example-a-theme-in-your-brand).

**Tokens:** the `--ask-*` variables listed in [Themes](themes.md#tokens). Only those are public API. The chat's stylesheet also defines the variables below; they are internal and can change in any release, so don't build on them.

| Internal variable | What it holds |
| --- | --- |
| `--ask-space` | The spacing unit: 8px, or 6px with the `compact` density |
| `--ask-radius-small` | A smaller radius, 0.6 × `--ask-radius` |
| `--ask-shadow` | The shadow of raised elements, mixed from `--ask-color-text` |
| `--ask-ring` | The ring around the focused message field, mixed from `--ask-color-accent` |
| `--ask-glass` | The translucent surface of the `glass` variant, mixed from `--ask-color-surface` |
| `--ask-ease` | The easing curve of transitions |
| `--ask-level` | The microphone level while recording, set by the chat |
| `--ask-aura-gradient-end` | Where Aura's gradient on the visitor's bubbles and the send button ends |

The launcher's short variables on your page (`--a`, `--o` and the like) are internal too.

**Parts** (`[data-ask-part="…"]`, public API): `panel`, `header`, `identity`, `identity-text`, `title`, `subtitle`, `actions`, `new-conversation`, `close`, `avatar`, `orb`, `messages`, `welcome`, `greeting`, `starters`, `starter`, `persona`, `persona-name`, `presence`, `intro`, `intro-card`, `message`, `message-body`, `bubble`, `image-alt`, `typing`, `citations`, `citation`, `attachments-note`, `status`, `error`, `composer`, `composer-box`, `input`, `attach`, `voice`, `send`, `attachments`, `message-attachments`, `attachment`, `attachment-preview`, `attachment-badge`, `attachment-name`, `attachment-status`, `attachment-remove`, `recorder`, `recorder-level`, `recorder-label`, `recorder-time`, `recorder-cancel`, `recorder-done`, `send-label` (shown by Aura), `disclosure`, and the question before a new conversation: `confirm-backdrop`, `confirm`, `confirm-icon`, `confirm-text`, `confirm-actions`, `confirm-cancel`, `confirm-accept`.

`identity-text` holds the title and subtitle in the header. `image-alt` stands in for an image in a reply: the chat never loads images that the model writes, so it shows their alt text in brackets.

**States** are attributes on the parts:

| Part | Attribute | Values |
| --- | --- | --- |
| `panel` | `data-busy` | Present while the assistant answers or a dictation runs |
| `panel` | `data-dragging` | Present while files are dragged over the chat (only when the bot accepts attachments) |
| `message` | `data-role` | `user`, `assistant` |
| `message` | `data-status` | `streaming`, `done`, `error` |
| `attachment` | `data-status` | `uploading`, `ready`, `error`, on files not sent yet; absent in sent messages |
| `attachment` | `data-kind` | `image`, `pdf`; absent until the chat has recognized the file |
| `recorder` | `data-state` | `recording`, `transcribing` |
| `avatar` | `data-kind` | `orb`, `icon`, `initials`, `image` |
| `avatar` | `data-size` | `small` in the header, next to the assistant's messages and in the `intro` welcome; `large` in the `hero` and `persona` welcome |
| `welcome` | `data-layout` | `hero`, `persona`, `intro` |

Select a present-or-absent attribute by its name alone, such as `[data-ask-part="panel"][data-dragging]`.

**Variants** of the theme are attributes on `<html>`: `data-ask-preset`, `data-ask-scheme`, `data-ask-avatar`, `data-ask-welcome`, `data-ask-launcher`, `data-ask-bubbles`, `data-ask-surface`, `data-ask-density`, `data-ask-composer`.

**The launcher** follows the theme's `launcher` variant: `circle` is a chat icon, `pill` the bot's picture or initials with its label, and `orb` the theme's orb with its label (Aura and Halo). The label is `launcherLabel`. It lives in a shadow root on your page. Style it from your own CSS with `::part`:

```css
[data-askdare]::part(launcher) { right: 32px; bottom: 32px; }
[data-askdare]::part(panel) { border-radius: 8px; }
```

The shadow root has three parts: `launcher`, `panel` (the dialog that holds the chat) and `unavailable` (the notice in the panel when the chat doesn't load). The element that holds the shadow root has `data-askdare` set to the bot ID, so `[data-askdare="support"]::part(launcher)` styles one bot's launcher only.

### Brand fonts

The chat's Content Security Policy allows fonts and stylesheets only from your app's own origin (`font-src 'self'`, `style-src 'self'`). So:

- Serve the font files from your app, for example from `public/fonts/` in Next.js.
- Declare them with `@font-face` in `widget.css`. Use a path that starts with `/`: `widget.css` is served from under the chat's base path, so a relative URL would point there.
- Fonts and stylesheets from other origins, such as a font CDN, are blocked, and so are fonts in `data:` URLs.

```ts
widget: {
  css: `
    @font-face {
      font-family: "Brand Sans";
      src: url("/fonts/brand-sans.woff2") format("woff2");
      font-display: swap;
    }
    :root {
      --ask-font-family: "Brand Sans", system-ui, sans-serif;
      --ask-font-family-heading: "Brand Sans", system-ui, sans-serif;
    }
  `,
}
```

Every preset sets both font tokens, so set both. You can also set them as the `fontFamily` and `headingFamily` tokens of a theme ([Themes](themes.md#adjust-a-preset)) and keep only the `@font-face` rule in `widget.css`. The launcher is on your page, not in the chat, so it can use your page's fonts through `::part(launcher)`.

## 3. Page JavaScript

```html
<!-- Your own button instead of the launcher -->
<button onclick="askdare('open')">Chat with us</button>
<script src="https://app.example.com/api/chat/widget.js?bot=support" data-launcher="none" async></script>

<!-- The chat inside your page -->
<div id="chat" style="height: 600px"></div>
<script src="https://app.example.com/api/chat/widget.js?bot=support" data-mode="inline" data-target="#chat" async></script>
```

| Call | Effect |
| --- | --- |
| `askdare('open')`, `askdare('close')`, `askdare('toggle')` | Shows or hides the chat. Closing returns focus to whatever opened it. |
| `askdare('identify', token)` | Signs the visitor in with a token from your backend, or out with `null`; see [Signed-in visitors](identity.md). |
| `askdare('configure', { greeting, starters, context })` | Per-page greeting and suggestions, and `context`: a short description of the page (up to 1000 characters) for the assistant. |

`configure` accepts only those three fields: never the model, instructions or tools. The context is off unless the bot opts in with `pageContext: true` in `defineBot`. It then travels with the visitor's message, as a marked part of their own turn: anyone can set it from their browser, so it gets no more trust than what the visitor types, and it never becomes part of the bot's instructions. It is sent again only when it changes, and the visitor's history doesn't show it. Define the small queue first, then call it any time:

```html
<script>
  // Safe to call before the script has loaded: calls queue up and run once it is ready.
  window.askdare = window.askdare || function () {
    (window.askdare.q = window.askdare.q || []).push(arguments);
  };
  askdare('configure', {
    greeting: 'Questions about our prices?',
    starters: ['How much is the Business plan?'],
    context: 'Pricing page listing the Free, Team and Business plans.',
  });
</script>
<script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
```

An inline chat loads with the page without taking focus or scrolling to itself.

In a React app, Next.js included, add the script after hydration, for example from a `useEffect` in a small client component. The loader adds the chat inside your element, and React must not find it there while it hydrates. The demo site's [`chat-script.tsx`](../site/app/chat-script.tsx) does this. The chat loads once per page load and lives as long as its element: put the element in a layout that stays, or link to the page with full page loads, because a client-side navigation away and back leaves the element empty.

## Accessibility

Accessibility is not configurable away. The focus ring is always visible, motion follows `prefers-reduced-motion`, the chat is a labelled dialog, and Escape closes it (or cancels a dictation). Every preset passes axe in every state, and its colors pass WCAG AA (AAA for text in Care); a customized theme with weak contrast triggers a warning in development.
