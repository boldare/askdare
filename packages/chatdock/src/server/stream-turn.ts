import type { Bot, BotContext } from '../bot/define-bot';
import { ChatdockError, TurnAbortedError, toChatdockError } from '../errors';
import type { ModelGateway, TokenUsage, TurnAttachment } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { encodeComment, encodeEvent } from '../protocol/sse';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '../protocol/version';

export interface StreamTurnOptions {
  readonly gateway: ModelGateway;
  readonly bot: Bot;
  /** Already validated user message; empty when only files are sent. */
  readonly text: string;
  /** Files from verified attachment handles. */
  readonly attachments?: readonly TurnAttachment[];
  readonly context: BotContext;
  readonly visitorId: string;
  /** Conversation to continue; a new one is created when absent. */
  readonly conversationId?: string | undefined;
  /** Aborted when the visitor disconnects. */
  readonly signal: AbortSignal;
  /** Issues the client-side handle for a newly created conversation. */
  readonly issueResumeToken: (conversationId: string) => Promise<string>;
  /** Called after a completed turn with real usage and the conversation it belongs to. */
  readonly onUsage?: ((usage: TokenUsage, conversationId: string) => void) | undefined;
  /** Server-side reporting hook. Receives client-safe errors with internals in `cause`. */
  readonly onError?: ((error: ChatdockError) => void) | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly generateId?: (() => string) | undefined;
}

export const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
  [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
};

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function defaultId(): string {
  return `msg_${crypto.randomUUID().replaceAll('-', '')}`;
}

function logError(error: ChatdockError): void {
  console.error(`[chatdock] turn failed: ${error.code}`, error.cause);
}

/**
 * Streams one chat turn as protocol v1 SSE. Sends a comment before any upstream call (Heroku's
 * 30 s first-byte rule), heartbeats on an independent timer (55 s idle rule), and enforces the
 * bot's turn deadline. A visitor disconnect aborts the upstream request and ends silently.
 */
export function streamTurn(options: StreamTurnOptions): ReadableStream<Uint8Array> {
  const { bot, gateway } = options;
  const generateId = options.generateId ?? defaultId;
  const reportError = options.onError ?? logError;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: ProtocolEvent): void => write(encodeEvent(event));
      const finish = (): void => {
        clearInterval(heartbeat);
        if (closed) return;
        closed = true;
        controller.close();
      };

      write(encodeComment('ok'));
      heartbeat = setInterval(
        () => write(encodeComment('ping')),
        options.heartbeatIntervalMs ?? 15_000,
      );
      const deadline = AbortSignal.timeout(bot.limits.turnTimeoutMs);
      const signal = AbortSignal.any([options.signal, deadline]);

      const run = async (): Promise<void> => {
        let conversationId = options.conversationId;
        if (conversationId === undefined) {
          conversationId = await gateway.createConversation(
            { botId: bot.id, visitorId: options.visitorId },
            signal,
          );
          emit({
            type: 'conversation.created',
            resumeToken: await options.issueResumeToken(conversationId),
          });
        }
        emit({ type: 'user.ack', messageId: generateId() });
        const messageId = generateId();
        emit({ type: 'message.start', messageId });
        const result = await gateway.runTurn({
          bot,
          conversationId,
          text: options.text,
          attachments: options.attachments ?? [],
          context: options.context,
          visitorId: options.visitorId,
          safetyIdentifier: await sha256Hex(options.visitorId),
          messageId,
          signal,
          emit,
        });
        options.onUsage?.(result.usage, conversationId);
        emit({ type: 'message.end', messageId, reason: result.reason });
      };

      run()
        .catch((error: unknown) => {
          const visitorLeft = options.signal.aborted && !deadline.aborted;
          if (visitorLeft || error instanceof TurnAbortedError) return;
          const failure = deadline.aborted
            ? new ChatdockError('timeout', { cause: error })
            : toChatdockError(error);
          reportError(failure);
          emit({
            type: 'error',
            code: failure.code,
            message: failure.message,
            retryAfterMs: failure.retryAfterMs,
          });
        })
        .finally(finish);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
    },
  });
}
