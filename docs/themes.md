# Themes

The widget comes with four looks, each in light and dark. Pick one, adjust it, or build your own on top of one. The decisions behind this are in [ADR-0008](adr/0008-ui-customization.md).

## Pick a preset

```ts
defineBot({
  // …
  widget: {
    title: 'Brightloop assistant',
    subtitle: 'Answers from our help center',
    greeting: 'Hi! How can I help?',
    starters: ['What does the Business plan include?', 'What are your support hours?'],
    theme: 'sage', // aura (default), halo, sage, care
    colorScheme: 'auto', // or 'light', 'dark'
  },
});
```

| Preset | Character | Welcome | Launcher | Fonts |
| --- | --- | --- | --- | --- |
| **Aura** (default) | Soft glass for AI products in Boldare's colors: an airy pastel field, a glossy bubble with its reflection, a two-weight headline (`**bold**` words in the greeting), a card composer with a Send pill | Centred greeting with pill suggestions | Orb | Plus Jakarta Sans |
| **Halo** | Clean and friendly: white into ice blue, a frosted orb in rings of light, a bold question, a round field with a soft blue mic | Centred greeting with pill suggestions | Orb | Geist |
| **Sage** | A calm companion: sage and mint, light type, a mint bubble for the assistant, black pill buttons, the mic beside the field | Persona card with an "Online" pill | Pill with avatar and label | Geist |
| **Care** | Trust first: indigo and lavender, larger hyperlegible type, AAA text contrast | Opening message with a checklist | Pill with label | Atkinson Hyperlegible Next |

`starters` are clickable suggestions (up to 4). `avatar` is the assistant's picture: a path on your app such as `/avatar.png`, or a small PNG, JPEG, WebP or GIF data URL. `launcherLabel` is the text of the pill launcher (default "Ask us").

To compare them, run the starter with `ASKDARE_GALLERY=1` and open `/gallery`: every state of the widget (welcome, conversation, streaming, attachments, error, dictation) in any preset, scheme and width. The starter's home page shows the same assistant in each preset: switch the theme and show the chat as a bubble or inside the page.

## Adjust a preset

```ts
import { defineTheme } from '@boldare/askdare';

export const brand = defineTheme({
  extends: 'aura',
  accent: '#a8875c', // buttons, links and your own messages; text on it is picked for contrast
  tokens: { radius: '12px' },
  dark: { accent: '#d4b48a' },
  variants: { launcher: 'pill', avatar: 'initials' },
});

defineBot({ /* … */ widget: { theme: brand } });
```

`defineTheme` validates once, so several bots can share a theme. In development, a theme whose colors are hard to read logs a warning with the failing pairs and their contrast ratios.

### Tokens

Each token is a CSS variable, set per bot from its theme. Colors are hex.

| Token | Variable | Used for |
| --- | --- | --- |
| `accent`, `onAccent` | `--ask-color-accent`, `--ask-color-on-accent` | Buttons, links, focus ring, and the text on them |
| `background` | `--ask-color-background` | Panel |
| `surface` | `--ask-color-surface` | Assistant bubbles, cards, chips |
| `text`, `muted` | `--ask-color-text`, `--ask-color-muted` | Text, secondary text |
| `border` | `--ask-color-border` | Hairlines (alpha allowed: `#rrggbbaa`) |
| `danger`, `success` | `--ask-color-danger`, `--ask-color-success` | Errors, checks |
| `userBubble`, `onUserBubble` | `--ask-color-user-bubble`, `--ask-color-on-user-bubble` | The visitor's messages |
| `backdrop` | `--ask-backdrop` | Background behind the panel, such as a gradient, or `none` |
| `orb` | `--ask-orb` | Paint of the orb avatar and launcher |
| `fontFamily`, `headingFamily` | `--ask-font-family`, `--ask-font-family-heading` | Text and headings |
| `fontSize` | `--ask-font-size` | Base size, 13px to 20px |
| `radius` | `--ask-radius` | Corner radius, 0px to 32px |

CSS values (`backdrop`, `orb`) may not contain `url()`, braces, semicolons or backslashes: they are written into a stylesheet.

### Variants

| Variant | Values |
| --- | --- |
| `avatar` | `orb`, `icon`, `initials`, `none` (a configured `avatar` picture wins) |
| `welcome` | `hero`, `persona`, `intro` |
| `launcher` | `orb`, `circle`, `pill` |
| `bubbles` | `filled`, `plain` |
| `surface` | `solid`, `glass` |
| `density` | `comfortable`, `compact` |
| `composer` | `outline`, `gradient` |

Variants are set as attributes on the iframe document (`data-ask-welcome="persona"` and so on), so your own CSS can target them too.

## Fonts

Fonts are OFL-licensed and served by your app, never from a CDN. A browser downloads only the fonts the chosen preset renders, and only the Latin Extended file when the text needs it (Polish, for example): at most about 80 KB per preset.

## How it is served

- The theme is a small stylesheet per bot, `/api/chat/theme/<bot>.css`, with a content hash in its URL, so the first paint already has the right colors. The iframe's CSP forbids inline styles.
- The launcher on the host page follows the theme: load the script as `widget.js?bot=<id>` and the server includes that bot's launcher look (colors, label, avatar path; public configuration) in it. `data-bot` on the tag still works, with the default launcher.
