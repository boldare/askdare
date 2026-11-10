import type { Bot } from '../bot/define-bot';
import type { ChatConfig } from '../chat/config';
import { textsFor } from '../i18n/texts';
import { PROTOCOL_VERSION } from '../protocol/version';
import type { ResolvedTheme } from '../theme/theme';

export interface PublicView {
  /** The language this visitor sees; default: the bot's, or English for `auto`. */
  readonly locale?: string | undefined;
  /** Default: the bot's theme. */
  readonly theme?: ResolvedTheme | undefined;
  /** Whether answers can be rated. Default: the bot's `widget.feedback`. */
  readonly feedback?: boolean | undefined;
}

/**
 * The public part of a bot, for browsers: the iframe's configuration and `getChatConfig` are both
 * built from it. It must never contain secrets, the model, instructions, tools or vector stores
 * (ADR-0008); a test checks that.
 */
export function publicConfig(bot: Bot, basePath: string, view: PublicView = {}): ChatConfig {
  const { theme, css: _css, texts: overrides, feedback, ...widget } = bot.widget;
  const resolved = view.theme ?? theme;
  const locale = view.locale ?? (widget.locale === 'auto' ? 'en' : widget.locale);
  const texts = textsFor(locale, overrides);
  return {
    protocolVersion: PROTOCOL_VERSION,
    basePath,
    botId: bot.id,
    pageContext: bot.pageContext,
    feedback: view.feedback ?? feedback,
    widget: {
      ...widget,
      locale,
      title: texts['header.title'] ?? widget.title,
      greeting: texts['welcome.greeting'] ?? widget.greeting,
      placeholder: texts['composer.placeholder'] ?? widget.placeholder,
      launcherLabel: texts['launcher.label'] ?? widget.launcherLabel,
      texts,
      preset: resolved.preset,
      variants: resolved.variants,
      colorScheme: resolved.colorScheme,
    },
    ...(bot.attachments ? { attachments: bot.attachments } : {}),
    ...(bot.voice ? { voice: { maxSeconds: bot.voice.maxSeconds } } : {}),
  };
}
