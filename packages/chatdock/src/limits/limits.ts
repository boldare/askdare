import type { Bot } from '../bot/define-bot';
import { ChatdockError, type ChatdockErrorOptions } from '../errors';
import type { TokenUsage } from '../gateway';
import type { RateLimitStore } from './store';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CONVERSATION_TTL = 30 * DAY;
/** Dictations transcribing at once, per IP and per bot, which bounds how far parallel requests can overshoot. */
const TRANSCRIPTIONS_IN_FLIGHT_PER_IP = 2;
const TRANSCRIPTIONS_IN_FLIGHT_PER_BOT = 10;
/** In-flight slots expire on their own if a process dies mid-transcription. */
const IN_FLIGHT_WINDOW = 2 * MINUTE;
/** Rough input cost of one file search chunk (about 800 tokens by default). */
const SEARCH_RESULT_TOKENS = 800;

export interface SessionLimitKeys {
  readonly clientIp: string;
  /** Set when a valid resume token proves a returning visitor; renewals are then counted per visitor. */
  readonly returningVisitorId?: string | undefined;
}

export interface TurnLimitKeys {
  readonly clientIp: string;
  readonly visitorId: string;
  readonly conversationId?: string | undefined;
  /** Characters sent to the model besides history (instructions + message), for the estimate. */
  readonly inputChars: number;
  /** Server estimate for the attached files (from their handles). */
  readonly attachmentTokens?: number;
}

export interface UploadLimitKeys {
  readonly clientIp: string;
  readonly visitorId: string;
}

/** Speech seconds and an in-flight slot held for a dictation; `settle` charges the billed duration and frees the slot. */
export interface TranscriptionReservation {
  settle(seconds: number): Promise<void>;
}

/** Budget held for a turn in flight. Without `settle`, the estimate stays charged. */
export interface TurnReservation {
  /** Replaces the estimate with real usage once the turn completed. */
  settle(usage: TokenUsage, conversationId: string): Promise<void>;
}

export interface Limits {
  checkSession(bot: Bot, keys: SessionLimitKeys): Promise<void>;
  /** Enforces rates, then atomically reserves tokens against every budget. */
  beginTurn(bot: Bot, keys: TurnLimitKeys): Promise<TurnReservation>;
  /** History reads and deletions: no tokens, but they still cost upstream calls. */
  checkConversationAccess(bot: Bot, visitorId: string): Promise<void>;
  /** File uploads: no tokens until sent (then reserved with the turn), but they use storage. */
  checkUpload(bot: Bot, keys: UploadLimitKeys): Promise<void>;
  /** Dictations: rate per visitor, then the longest allowed duration reserved against daily speech budgets. */
  beginTranscription(bot: Bot, keys: UploadLimitKeys): Promise<TranscriptionReservation>;
  /** `chatdock doctor` runs, which make small OpenAI requests: a few per minute for the whole app. */
  checkDoctor(): Promise<void>;
}

export interface LimitsOptions {
  readonly store: RateLimitStore;
  /** Input plus output tokens per UTC day across all bots. Unlimited when absent. */
  readonly globalDailyTokens?: number | undefined;
  /** When it returns true, every bot answers `bot_unavailable` (CHATDOCK_DISABLED). */
  readonly disabled?: () => boolean;
  /** Clock in ms, for tests. */
  readonly now?: () => number;
}

interface Budget {
  readonly key: string;
  readonly limit: number;
}

/**
 * Bounds what an anonymous visitor can cost (ADR-0004). Each turn first passes request-rate limits,
 * then reserves an estimate (expected input + `maxOutputTokens`) against the bot, per-IP and
 * global daily budgets. The reservation is atomic, so concurrent turns can't overshoot, and it
 * stays charged when a turn is aborted or fails, so disconnecting early saves the attacker nothing.
 */
export function createLimits(options: LimitsOptions): Limits {
  const { store } = options;
  const now = options.now ?? Date.now;

  const assertEnabled = (): void => {
    if (options.disabled?.()) throw new ChatdockError('bot_unavailable');
  };

  const enforce = async (
    key: string,
    windowMs: number,
    limit: number,
    custom?: Pick<ChatdockErrorOptions, 'message' | 'key'>,
  ) => {
    const { count, resetMs } = await store.hit(key, windowMs, 1);
    if (count > limit) {
      throw new ChatdockError('rate_limited', {
        retryAfterMs: Math.max(resetMs, 1000),
        ...custom,
      });
    }
  };

  const day = (): string => new Date(now()).toISOString().slice(0, 10);
  const untilMidnight = (): number => Date.parse(`${day()}T00:00:00Z`) + DAY - now();

  const budgets = (bot: Bot, clientIp: string): Budget[] => [
    { key: `cd:t:${bot.id}:${day()}`, limit: bot.limits.dailyTokens },
    { key: `cd:ti:${bot.id}:${clientIp}:${day()}`, limit: bot.limits.dailyTokensPerIp },
    ...(options.globalDailyTokens === undefined
      ? []
      : [{ key: `cd:tg:${day()}`, limit: options.globalDailyTokens }]),
  ];

  const reserve = async (list: readonly Budget[], amount: number): Promise<void> => {
    const charged: Budget[] = [];
    for (const budget of list) {
      const { count } = await store.hit(budget.key, 2 * DAY, amount);
      charged.push(budget);
      if (count > budget.limit) {
        await Promise.all(charged.map((item) => store.hit(item.key, 2 * DAY, -amount)));
        throw new ChatdockError('budget_exceeded', {
          retryAfterMs: Math.max(untilMidnight(), 1000),
        });
      }
    }
  };

  return {
    async checkSession(bot, keys) {
      assertEnabled();
      if (keys.returningVisitorId) {
        await enforce(`cd:sv:${bot.id}:${keys.returningVisitorId}`, HOUR, 12);
      } else {
        await enforce(`cd:s:${bot.id}:${keys.clientIp}`, HOUR, bot.limits.sessionsPerIpPerHour);
      }
    },

    async checkDoctor() {
      assertEnabled();
      await enforce('cd:doctor', MINUTE, 3);
    },

    async checkConversationAccess(bot, visitorId) {
      assertEnabled();
      await enforce(`cd:r:${bot.id}:${visitorId}`, MINUTE, 20);
    },

    async checkUpload(bot, keys) {
      assertEnabled();
      await enforce(`cd:uv:${bot.id}:${keys.visitorId}`, HOUR, bot.limits.uploadsPerVisitorPerHour);
      await enforce(`cd:ui:${bot.id}:${keys.clientIp}`, HOUR, bot.limits.uploadsPerIpPerHour);
      await enforce(`cd:ud:${bot.id}:${day()}`, DAY, bot.limits.uploadsPerDay);
    },

    async beginTranscription(bot, keys) {
      assertEnabled();
      const { limits } = bot;
      await enforce(
        `cd:tv:${bot.id}:${keys.visitorId}`,
        HOUR,
        limits.transcriptionsPerVisitorPerHour,
      );
      const slots = [
        { key: `cd:tfi:${bot.id}:${keys.clientIp}`, limit: TRANSCRIPTIONS_IN_FLIGHT_PER_IP },
        { key: `cd:tfb:${bot.id}`, limit: TRANSCRIPTIONS_IN_FLIGHT_PER_BOT },
      ];
      const taken: { readonly key: string }[] = [];
      const release = () =>
        Promise.all(taken.map((slot) => store.hit(slot.key, IN_FLIGHT_WINDOW, -1)));
      for (const slot of slots) {
        const { count } = await store.hit(slot.key, IN_FLIGHT_WINDOW, 1);
        taken.push(slot);
        if (count > slot.limit) {
          await release();
          throw new ChatdockError('rate_limited', {
            retryAfterMs: 5_000,
            message: 'Another dictation is still being transcribed. Please try again in a moment.',
            key: 'error.dictationBusy',
          });
        }
      }
      const reserved = bot.voice?.maxSeconds ?? 60;
      const list: Budget[] = [
        { key: `cd:vs:${bot.id}:${day()}`, limit: limits.voiceSecondsPerDay },
        {
          key: `cd:vsi:${bot.id}:${keys.clientIp}:${day()}`,
          limit: limits.voiceSecondsPerIpPerDay,
        },
      ];
      try {
        await reserve(list, reserved);
      } catch (error) {
        await release();
        throw error;
      }
      return {
        async settle(seconds) {
          // Whole seconds: shared stores count in integers.
          const difference = Math.ceil(seconds) - reserved;
          await Promise.all([
            ...list.map((budget) => store.hit(budget.key, 2 * DAY, difference)),
            release(),
          ]);
        },
      };
    },

    async beginTurn(bot, keys) {
      assertEnabled();
      const { limits } = bot;
      await enforce(
        `cd:mv:${bot.id}:${keys.visitorId}`,
        MINUTE,
        limits.messagesPerVisitorPerMinute,
      );
      await enforce(`cd:mi:${bot.id}:${keys.clientIp}`, MINUTE, limits.messagesPerIpPerMinute);
      let historyTokens = 0;
      if (keys.conversationId) {
        await enforce(`cd:c:${keys.conversationId}`, CONVERSATION_TTL, limits.maxTurns, {
          message: 'This conversation is too long. Please start a new one.',
          key: 'error.conversationTooLong',
        });
        historyTokens = (await store.hit(`cd:ci:${keys.conversationId}`, CONVERSATION_TTL, 0))
          .count;
      } else {
        await enforce(`cd:cc:${bot.id}:${keys.clientIp}`, HOUR, limits.conversationsPerIpPerHour);
      }

      const estimate =
        historyTokens +
        Math.ceil(keys.inputChars / 2) +
        limits.maxOutputTokens +
        // Every model call of the turn re-reads the files, and function tools add calls.
        (keys.attachmentTokens ?? 0) * (bot.tools.length > 0 ? limits.maxSteps : 1) +
        (bot.knowledge ? bot.knowledge.maxResults * SEARCH_RESULT_TOKENS : 0);
      const list = budgets(bot, keys.clientIp);
      await reserve(list, estimate);

      return {
        async settle(usage, conversationId) {
          const actual = usage.inputTokens + usage.outputTokens;
          await Promise.all(
            list.map((budget) => store.hit(budget.key, 2 * DAY, actual - estimate)),
          );
          // Remember the conversation's size so the next turn's estimate includes its history.
          const inputKey = `cd:ci:${conversationId}`;
          const previous = (await store.hit(inputKey, CONVERSATION_TTL, 0)).count;
          await store.hit(inputKey, CONVERSATION_TTL, usage.inputTokens - previous);
          if (!keys.conversationId) await store.hit(`cd:c:${conversationId}`, CONVERSATION_TTL, 1);
        },
      };
    },
  };
}
