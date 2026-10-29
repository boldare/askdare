import type { Bot } from '../bot/define-bot';
import { PROTOCOL_VERSION } from '../protocol/version';
import { themeAttributes, themeStylesheet } from '../theme/css';
import type { PresetName, ThemeVariants } from '../theme/presets';
import type { ResolvedTheme } from '../theme/theme';

/** Built iframe app and loader, inlined into the package at build time (no runtime file reads). */
export interface EmbedAssets {
  readonly loaderJs: string;
  readonly widgetJs: string;
  readonly widgetCss: string;
  /** Content-hashed file names, served with immutable caching. */
  readonly widgetJsFile: string;
  readonly widgetCssFile: string;
  /** `@font-face` rules of the presets; browsers fetch only the fonts in use. */
  readonly fontsCss: string;
  readonly fontsCssFile: string;
  /** Base64 woff2 files by published name. */
  readonly fontFiles: Readonly<Record<string, string>>;
}

/** States the gallery can render without a model, for design review and visual tests. */
export const GALLERY_STATES = [
  'welcome',
  'conversation',
  'streaming',
  'attachments',
  'error',
  'listening',
] as const;
export type GalleryState = (typeof GALLERY_STATES)[number];

/** The widget settings the iframe app needs; colors arrive as the theme stylesheet. */
export type EmbedWidget = Omit<Bot['widget'], 'theme'> & {
  readonly preset: PresetName;
  readonly variants: ThemeVariants;
};

/** Public configuration handed to the iframe app. Must never contain secrets. */
export interface EmbedConfig {
  readonly protocolVersion: number;
  readonly basePath: string;
  readonly botId: string;
  readonly allowedOrigins: readonly string[];
  readonly widget: EmbedWidget;
  /** Only in gallery mode: render this state from fixtures instead of talking to the server. */
  readonly gallery?: GalleryState;
  /** What the visitor may attach; absent when attachments are off. */
  readonly attachments?: NonNullable<Bot['attachments']>;
  /** Dictation settings; absent when voice input is off. The model stays on the server. */
  readonly voice?: { readonly maxSeconds: number };
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** JSON that is safe inside a `<script type="application/json">` element. */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

export interface EmbedView {
  readonly theme: ResolvedTheme;
  /** Theme stylesheet URL, content-hashed. */
  readonly themeHref: string;
  readonly gallery?: GalleryState | undefined;
}

export function embedConfig(bot: Bot, basePath: string, view?: EmbedView): EmbedConfig {
  const { theme, ...widget } = bot.widget;
  const resolved = view?.theme ?? theme;
  return {
    protocolVersion: PROTOCOL_VERSION,
    basePath,
    botId: bot.id,
    allowedOrigins: bot.security.allowedOrigins,
    widget: { ...widget, preset: resolved.preset, variants: resolved.variants },
    ...(view?.gallery ? { gallery: view.gallery } : {}),
    ...(bot.attachments ? { attachments: bot.attachments } : {}),
    ...(bot.voice ? { voice: { maxSeconds: bot.voice.maxSeconds } } : {}),
  };
}

/**
 * Content Security Policy for the iframe document: same-origin resources only, no inline script,
 * and `frame-ancestors` limited to the app itself plus the bot's allowlist (ADR-0005).
 */
export function embedContentSecurityPolicy(bot: Bot): string {
  const ancestors = ["'self'", ...bot.security.allowedOrigins].join(' ');
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    // blob: previews the visitor's own files before they are sent.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

/** Stylesheet and content hash of a theme, cached per distinct theme. */
const stylesheets = new WeakMap<ResolvedTheme, { css: string; hash: string }>();

export function themeAsset(theme: ResolvedTheme): { css: string; hash: string } {
  let asset = stylesheets.get(theme);
  if (!asset) {
    const css = themeStylesheet(theme);
    // FNV-1a: only a cache key for the URL, not a security boundary.
    let value = 0x811c9dc5;
    for (let index = 0; index < css.length; index += 1) {
      value = Math.imul(value ^ css.charCodeAt(index), 0x01000193) >>> 0;
    }
    asset = { css, hash: value.toString(16).padStart(8, '0') };
    stylesheets.set(theme, asset);
  }
  return asset;
}

export function renderEmbedPage(
  bot: Bot,
  basePath: string,
  assets: EmbedAssets,
  view: EmbedView,
): string {
  const config = embedConfig(bot, basePath, view);
  const attributes = Object.entries(themeAttributes(view.theme))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(bot.widget.locale)}"${attributes}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(bot.widget.title)}</title>`,
    `<link rel="stylesheet" href="${basePath}/assets/${assets.fontsCssFile}">`,
    `<link rel="stylesheet" href="${basePath}/assets/${assets.widgetCssFile}">`,
    `<link rel="stylesheet" href="${escapeHtml(view.themeHref)}">`,
    '</head>',
    '<body>',
    '<div id="chatdock-root"></div>',
    `<script type="application/json" id="chatdock-config">${scriptSafeJson(config)}</script>`,
    `<script type="module" src="${basePath}/assets/${assets.widgetJsFile}"></script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
