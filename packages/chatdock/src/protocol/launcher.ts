/**
 * How a bot's launcher looks on the host page. The server inlines one per bot into widget.js, so
 * the launcher is drawn correctly before anything else loads. Public data only.
 */
export interface LauncherLook {
  readonly style: 'orb' | 'circle' | 'pill';
  /** Visible text of the pill launcher. */
  readonly label: string;
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
  readonly scheme: 'auto' | 'light' | 'dark';
  readonly radius: string;
}

/** Replaced in the served loader by a JSON object of looks keyed by bot ID. */
export const LAUNCHER_PLACEHOLDER = '__CHATDOCK_LAUNCHERS__';
