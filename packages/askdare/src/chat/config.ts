import type { PresetName, ThemeVariants } from '../theme/presets';

/** What a visitor may attach, as the bot allows it. */
export interface ChatAttachments {
  readonly images: boolean;
  readonly pdf: boolean;
  readonly maxBytes: number;
  readonly maxPerMessage: number;
  readonly maxPdfPages: number;
}

/** A bot's public widget settings, in the visitor's language. */
export interface ChatWidget {
  readonly title: string;
  readonly subtitle: string;
  readonly greeting: string;
  readonly placeholder: string;
  /** The language this visitor sees. */
  readonly locale: string;
  readonly starters: readonly string[];
  readonly avatar: string | undefined;
  readonly launcherLabel: string;
  readonly disclosure: false | { readonly privacyUrl: string | undefined };
  readonly preset: PresetName;
  readonly variants: ThemeVariants;
  /** `auto` follows the visitor's system setting. */
  readonly colorScheme: 'auto' | 'light' | 'dark';
  /** Every text in the visitor's language, overrides applied; plural keys included. */
  readonly texts: Readonly<Record<string, string>>;
}

/** Stylesheets of a chat inside a page, served by the chat route (ADR-0011). */
export interface ChatStyles {
  /** The bot's tokens for both color schemes, then its own `widget.css`. */
  readonly theme: string;
  /** The default look; only `DefaultChat` loads it. */
  readonly skin: string;
  /** `@font-face` rules of the built-in themes; browsers fetch only the fonts in use. */
  readonly fonts: string;
}

/** What the browser needs to run one bot's chat. Public: it never holds secrets (ADR-0008). */
export interface ChatConfig {
  readonly protocolVersion: number;
  /** Path of the chat route, such as `/api/chat`. Same origin only (ADR-0011). */
  readonly basePath: string;
  readonly botId: string;
  readonly widget: ChatWidget;
  /** Whether the bot accepts a description of the page it is on. */
  readonly pageContext: boolean;
  /** Whether the bot lets visitors rate answers. Answers carry a handle when the route takes ratings. */
  readonly feedback: boolean;
  /** Absent when attachments are off. */
  readonly attachments?: ChatAttachments;
  /** Absent when voice input is off. The model stays on the server. */
  readonly voice?: { readonly maxSeconds: number };
  /** From `getChatConfig`, for a chat inside a page. The iframe links its own stylesheets. */
  readonly styles?: ChatStyles;
}
