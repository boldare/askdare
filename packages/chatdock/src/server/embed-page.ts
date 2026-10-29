import type { Bot } from '../bot/define-bot';
import { PROTOCOL_VERSION } from '../protocol/version';

/** Built iframe app and loader, inlined into the package at build time (no runtime file reads). */
export interface EmbedAssets {
  readonly loaderJs: string;
  readonly widgetJs: string;
  readonly widgetCss: string;
  /** Content-hashed file names, served with immutable caching. */
  readonly widgetJsFile: string;
  readonly widgetCssFile: string;
}

/** Public configuration handed to the iframe app. Must never contain secrets. */
export interface EmbedConfig {
  readonly protocolVersion: number;
  readonly basePath: string;
  readonly botId: string;
  readonly allowedOrigins: readonly string[];
  readonly widget: Bot['widget'];
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

export function embedConfig(bot: Bot, basePath: string): EmbedConfig {
  return {
    protocolVersion: PROTOCOL_VERSION,
    basePath,
    botId: bot.id,
    allowedOrigins: bot.security.allowedOrigins,
    widget: bot.widget,
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
    "img-src 'self' data:",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors}`,
  ].join('; ');
}

export function renderEmbedPage(bot: Bot, basePath: string, assets: EmbedAssets): string {
  const config = embedConfig(bot, basePath);
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(bot.widget.locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(bot.widget.title)}</title>`,
    `<link rel="stylesheet" href="${basePath}/assets/${assets.widgetCssFile}">`,
    '</head>',
    '<body>',
    '<div id="chatdock-root"></div>',
    `<script type="application/json" id="chatdock-config">${scriptSafeJson(config)}</script>`,
    `<script type="module" src="${basePath}/assets/${assets.widgetJsFile}"></script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
