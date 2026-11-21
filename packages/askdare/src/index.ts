export type {
  AttachmentConfig,
  BotContext,
  BotDefinition,
  BotHandle,
  BotLimits,
  BotSecurity,
  KnowledgeConfig,
  VoiceConfig,
  WidgetConfig,
} from './bot/define-bot';
export { defineBot } from './bot/define-bot';
export type { CounterHit, RateLimitStore } from './limits/store';
export type { ErrorCode } from './protocol/events';
export { ERROR_CODES } from './protocol/events';
export { PROTOCOL_VERSION } from './protocol/version';
export type { VisitorIdentity } from './security/identity';
export type { PresetName, ThemeTokens, ThemeVariants } from './theme/presets';
export type { ColorScheme, ThemeDefinition } from './theme/theme';
export { defineTheme } from './theme/theme';
export type { Tool, ToolContext, ToolDefinition } from './tools/define-tool';
export { defineTool } from './tools/define-tool';
