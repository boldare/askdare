/**
 * How a bot's launcher looks on the host page. The server inlines one per bot into widget.js, so
 * the launcher is drawn correctly before anything else loads. Public data only.
 */
/** The launcher's own texts in one language. */
export interface LauncherTexts {
  /** Visible text of the pill launcher. */
  readonly label: string;
  /** Accessible names of the button while the chat is closed and open. */
  readonly open: string;
  readonly close: string;
  /** Accessible name of the chat dialog. */
  readonly title: string;
}

export interface LauncherLook {
  readonly style: 'orb' | 'circle' | 'pill';
  /** Texts per built-in language (`en`, `pl`). */
  readonly texts: Readonly<Record<string, LauncherTexts>>;
  /** The bot's language when it is fixed; absent for `auto`, where the host page's applies. */
  readonly locale?: string;
  readonly accent: string;
  readonly onAccent: string;
  /** CSS background of the orb launcher. */
  readonly orb: string;
  /** A path on the app (made absolute by the loader) or a data: image. */
  readonly avatar?: string;
  readonly initials: string;
  /** Panel background while the chat loads, per color scheme. */
  readonly light: string;
  readonly dark: string;
  /** Text on those backgrounds: the orb launcher's label sits on them. */
  readonly text: string;
  readonly textDark: string;
  readonly scheme: 'auto' | 'light' | 'dark';
  readonly radius: string;
}

/** Replaced, quotes included, in the served loader by a JSON string of the requested bot's look. */
export const LAUNCHER_PLACEHOLDER = '__ASKDARE_LAUNCHERS__';
