# Themes

The widget comes with four looks, each in light and dark. Pick one, adjust it, or build your own on top of one. The decisions behind this are in [ADR-0008](adr/0008-ui-customization-and-themes.md).

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

To compare them, run the demo site from the repository (`site/`) with `ASKDARE_GALLERY=1` and open `/gallery`: every state of the widget (welcome, conversation, streaming, attachments, error, listening) in any preset, scheme and width. The site's home page shows the same assistant in each preset: switch the theme and show the chat as a bubble or inside the page.

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

## Example: a theme in your brand

The demo site's BLDR theme puts the chat in Boldare's style: ink and light grey, heavy type, square corners, and yellow buttons with a hard ink shadow. It takes three steps, all on the public API. Try it on the home page: pick the yellow diamond in the dock at the bottom.

**1. Tokens and variants** set the colors, type and shapes. Start from the preset closest to your brand and override what differs:

```ts
import { defineTheme } from '@boldare/askdare';

export const bldr = defineTheme({
  extends: 'halo',
  tokens: {
    accent: '#242424',
    onAccent: '#ffffff',
    background: '#f1f1f1',
    surface: '#ffffff',
    text: '#242424',
    muted: '#4f4f4f',
    border: '#24242433',
    userBubble: '#242424',
    onUserBubble: '#ffffff',
    backdrop: 'none',
    orb: 'radial-gradient(circle at 35% 30%, #fff7c2 0%, #f2da3a 50%, #c4ac12 100%)',
    // Aura's font: it ships with the library, so the chat can use it in any theme.
    fontFamily: '"Plus Jakarta Sans Variable", system-ui, sans-serif',
    headingFamily: '"Plus Jakarta Sans Variable", system-ui, sans-serif',
    radius: '0px',
  },
  variants: { avatar: 'initials', launcher: 'pill', surface: 'solid', composer: 'outline' },
});
```

**2. Your own CSS** in `widget.css` adds what tokens can't: the dark header, the yellow highlight in the greeting, and hard shadows that buttons press into. Select parts by `data-ask-part` ([Styling](styling.md#2-your-own-css)):

```ts
const BLDR_CSS = `
  [data-ask-part="header"] { background: #242424; color: #fff; border-bottom: 0; }
  [data-ask-part="subtitle"] { color: #c9c9c9; }
  [data-ask-part="header"] button { color: #fff; }
  [data-ask-part="avatar"] { border-radius: 0; background: #f2da3a; color: #242424; font-weight: 800; }
  [data-ask-part="greeting"] strong { padding: 0 0.15em; background: #f2da3a; box-decoration-break: clone; }
  [data-ask-part="starter"] {
    border: 2px solid #242424; border-radius: 0; background: #fff; box-shadow: -4px 4px 0 #242424;
  }
  [data-ask-part="starter"]:hover:not(:disabled) {
    transform: translate(2px, -2px); box-shadow: -6px 6px 0 #242424;
  }
  [data-ask-part="message"][data-role="assistant"] [data-ask-part="bubble"] { border: 2px solid #242424; }
  [data-ask-part="composer-box"] { border: 2px solid #242424; border-radius: 0; box-shadow: none; }
  [data-ask-part="send"] {
    border: 2px solid #242424; border-radius: 0; background: #f2da3a; color: #242424;
    box-shadow: -3px 3px 0 #242424;
  }
`;

defineBot({
  // …
  widget: {
    theme: bldr,
    css: BLDR_CSS,
    greeting: 'Your **AI partner** for Brightloop questions', // **bold** gets the yellow highlight
    launcherLabel: 'Ask Boldare',
  },
});
```

**3. The chat button** is on your page, not in the chat, so style it with your page's CSS through `::part(launcher)`. See "The launcher" in [Styling](styling.md#2-your-own-css):

```css
[data-askdare="bldr"]::part(launcher) {
  border: 2px solid #242424;
  border-radius: 0;
  background: #f2da3a;
  color: #242424;
  box-shadow: -4px 4px 0 #242424;
}
```

Check the result in both color schemes, or set `colorScheme: 'light'` as BLDR does when you style only one. In development, `defineTheme` warns about color pairs that are hard to read; it can't check colors in your own CSS, so check those yourself.

## Fonts

Fonts are OFL-licensed and served by your app, never from a CDN. A browser downloads only the fonts the chosen preset renders, and only the Latin Extended file when the text needs it (Polish, for example): at most about 80 KB per preset.

## How it is served

- The theme is a small stylesheet per bot, `/api/chat/theme/<bot>.css`, with a content hash in its URL, so the first paint already has the right colors. The iframe's CSP forbids inline styles.
- The launcher on the host page follows the theme: load the script as `widget.js?bot=<id>` and the server includes that bot's launcher look (colors, label, avatar path; public configuration) in it. `data-bot` on the tag still works, with the default launcher.
