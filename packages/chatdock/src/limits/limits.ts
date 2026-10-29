import type { Bot } from '../bot/define-bot';
import { ChatdockError } from '../errors';
import type { TokenUsage } from '../gateway';
import type { RateLimitStore } from './store';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface Limits {
  /** Before issuing a session. */
  checkSession(bot: Bot, clientIp: string): Promise<void>;
  /** Before a turn: kill switch, daily budget, request rates and conversation length. */
  checkMessage(bot: Bot, request: MessageLimitKeys): Promise<void>;
  /** After a turn, so the daily budget reflects real usage. */
  recordUsage(bot: Bot, usage: TokenUsage): Promise<void>;
}

export interface MessageLimitKeys {
  readonly clientIp: string;
  readonly visitorId: string;
  readonly conversationId?: string | undefined;
}

export interface LimitsOptions {
  readonly store: RateLimitStore;
  /** When it returns true, every bot answers `bot_unavailable` (CHATDOCK_DISABLED). */
  readonly disabled?: () => boolean;
  /** Clock in ms, for tests. */
  readonly now?: () => number;
}

function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Bounds what an anonymous visitor can cost (ADR-0004): sessions per IP, messages per visitor and
 * per IP, turns per conversation, and a daily token budget per bot. The budget is checked before
 * a turn and recorded after it, so one turn in flight can overshoot it slightly.
 */
export function createLimits(options: LimitsOptions): Limits {
  const { store } = options;
  const now = options.now ?? Date.now;

  const enforce = async (
    key: string,
    windowMs: number,
    limit: number,
    code: 'rate_limited' | 'budget_exceeded',
  ): Promise<void> => {
    const { count, resetMs } = await store.hit(key, windowMs, 1);
    if (count > limit) throw new ChatdockError(code, { retryAfterMs: Math.max(resetMs, 1000) });
  };

  return {
    async checkSession(bot, clientIp) {
      if (options.disabled?.()) throw new ChatdockError('bot_unavailable');
      await enforce(
        `cd:s:${bot.id}:${clientIp}`,
        HOUR,
        bot.limits.sessionsPerIpPerHour,
        'rate_limited',
      );
    },

    async checkMessage(bot, keys) {
      if (options.disabled?.()) throw new ChatdockError('bot_unavailable');
      const day = utcDay(now());
      const spent = await store.hit(`cd:t:${bot.id}:${day}`, 2 * DAY, 0);
      if (spent.count >= bot.limits.dailyTokens) {
        const midnight = Date.parse(`${day}T00:00:00Z`) + DAY;
        throw new ChatdockError('budget_exceeded', {
          retryAfterMs: Math.max(midnight - now(), 1000),
        });
      }
      await enforce(
        `cd:mv:${bot.id}:${keys.visitorId}`,
        MINUTE,
        bot.limits.messagesPerVisitorPerMinute,
        'rate_limited',
      );
      await enforce(
        `cd:mi:${bot.id}:${keys.clientIp}`,
        MINUTE,
        bot.limits.messagesPerIpPerMinute,
        'rate_limited',
      );
      if (keys.conversationId) {
        const turns = await store.hit(`cd:c:${keys.conversationId}`, 30 * DAY, 1);
        if (turns.count > bot.limits.maxTurns) {
          throw new ChatdockError('rate_limited', {
            message: 'This conversation is too long. Please start a new one.',
          });
        }
      }
    },

    async recordUsage(bot, usage) {
      const tokens = usage.inputTokens + usage.outputTokens;
      if (tokens > 0) await store.hit(`cd:t:${bot.id}:${utcDay(now())}`, 2 * DAY, tokens);
    },
  };
}
