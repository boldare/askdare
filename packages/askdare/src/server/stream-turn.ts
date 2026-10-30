import type { Bot, BotContext } from '../bot/define-bot';
import { AskdareError, TurnAbortedError, toAskdareError } from '../errors';
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
  /** What the host page says about itself; untrusted. */
  readonly pageContext?: string | undefined;
  readonly context: BotContext;
  readonly visitorId: string;
  /** Conversation to continue; a new one is created when absent. */
  readonly conversationId?: string | undefined;
  /** Aborted when the visitor disconnects. Ends the stream, not a model call already under way. */
  readonly signal: AbortSignal;
  /** Keeps the turn alive after the response ends (serverless platforms), e.g. Next.js `after`. */
  readonly waitUntil?: ((work: Promise<unknown>) => void) | undefined;
  /** Turns the visitor's or user's ID into OpenAI's `safety_identifier` (an HMAC). */
  readonly pseudonym: (value: string) => Promise<string>;
  /** Issues the client-side handle for a new conversation, and a fresh one after each turn. */
  readonly issueResumeToken: (conversationId: string) => Promise<string>;
  /** Called after a completed turn with real usage and the conversation it belongs to. */
  readonly onUsage?: ((usage: TokenUsage, conversationId: string) => void) | undefined;
  /** Holds the budget for one more model call before a tool round; see `TurnRequest`. */
  readonly reserveCall?: (() => Promise<boolean>) | undefined;
  /** Server-side reporting hook. Receives client-safe errors with internals in `cause`. */
  readonly onError?: ((error: AskdareError) => void) | undefined;
  /** Development only: a setup error's description, shown in the chat instead of the generic one. */
  readonly explain?: ((error: AskdareError) => string | undefined) | undefined;
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

function defaultId(): string {
  return `msg_${crypto.randomUUID().replaceAll('-', '')}`;
}

function logError(error: AskdareError): void {
  console.error(`[askdare] turn failed: ${error.code}`, error.cause);
}

/**
 * Streams one chat turn as protocol v1 SSE. Sends a comment before any upstream call (Heroku's
 * 30 s first-byte rule), heartbeats on an independent timer (55 s idle rule), and enforces the
 * bot's turn deadline.
 *
 * A visitor who disconnects stops the stream, not the model: once the model call has started, it
 * runs to completion, so the turn is charged its real usage (an aborted response is gone, usage
 * included) and the answer is waiting in the conversation when they return.
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
      const visitorLeft = (): boolean => options.signal.aborted;

      const run = async (): Promise<void> => {
        // Nothing has been spent upstream yet.
        if (visitorLeft()) return;
        let conversationId = options.conversationId;
        if (conversationId === undefined) {
          conversationId = await gateway.createConversation(
            { botId: bot.id, visitorId: options.visitorId },
            deadline,
          );
          const resumeToken = await options.issueResumeToken(conversationId);
          if (visitorLeft()) {
            // They never received its handle, so nobody could reach or delete it later.
            await gateway.deleteConversation(conversationId);
            return;
          }
          emit({ type: 'conversation.created', resumeToken });
        }
        if (visitorLeft()) return;
        emit({ type: 'user.ack', messageId: generateId() });
        const messageId = generateId();
        emit({ type: 'message.start', messageId });
        const result = await gateway.runTurn({
          bot,
          conversationId,
          text: options.text,
          attachments: options.attachments ?? [],
          pageContext: options.pageContext,
          context: options.context,
          visitorId: options.visitorId,
          // The signed-in user when there is one, so abuse is traced to a person across devices.
          safetyIdentifier: await options.pseudonym(
            options.context.identity ? `user:${options.context.identity.id}` : options.visitorId,
          ),
          messageId,
          signal: deadline,
          emit,
          reserveCall: options.reserveCall,
        });
        options.onUsage?.(result.usage, conversationId);
        // A resumed conversation gets a fresh handle: its 30 days count from the last message.
        // Best effort: the old handle stays valid until it expires.
        const resumeToken = options.conversationId
          ? await options.issueResumeToken(conversationId).catch(() => undefined)
          : undefined;
        emit({
          type: 'message.end',
          messageId,
          reason: result.reason,
          ...(resumeToken ? { resumeToken } : {}),
        });
      };

      const work = run()
        .catch((error: unknown) => {
          if (error instanceof TurnAbortedError) return;
          const failure = deadline.aborted
            ? new AskdareError('timeout', { cause: error })
            : toAskdareError(error);
          reportError(failure);
          const explanation = options.explain?.(failure);
          emit({
            type: 'error',
            code: failure.code,
            message: explanation ?? failure.message,
            retryAfterMs: failure.retryAfterMs,
            key: explanation ? undefined : failure.key,
            params: failure.params,
          });
        })
        .finally(finish);
      try {
        options.waitUntil?.(work);
      } catch {
        // The turn still runs; only its lifetime after the response isn't extended.
      }
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
    },
  });
}
