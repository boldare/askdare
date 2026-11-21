import type { Bot, BotContext } from '../bot/define-bot';
import { checksInput, checksOutput } from '../bot/guardrails';
import { AskdareError, forLog, TurnAbortedError, toAskdareError } from '../errors';
import type { ModelGateway, TokenUsage, ToolCallRecord, TurnAttachment } from '../gateway';
import type {
  ErrorCode,
  FeedbackHandle,
  MessageEndReason,
  ProtocolEvent,
} from '../protocol/events';
import { normalizeReplies } from '../protocol/replies';
import { encodeComment, encodeEvent } from '../protocol/sse';
import { MAX_TOOL_UI } from '../protocol/tool-ui';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '../protocol/version';
import { addUsage, ZERO_USAGE } from '../usage';
import { blockedError, type GuardOptions, guardInput, guardOutput } from './guardrails';
import type { ChatUsageReport } from './usage-report';

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
  /** Settles the budget after a completed turn, with real usage and its conversation. */
  readonly settle?: ((usage: TokenUsage, conversationId: string) => void) | undefined;
  /**
   * Receives the turn's report once the stream has ended, for the `onUsage` hook. Awaited inside
   * the turn's `waitUntil` work; whatever it throws is caught.
   */
  readonly report?: ((report: ChatUsageReport) => void | Promise<void>) | undefined;
  /** Issues the rating handle of the answer; absent when the bot's answers can't be rated. */
  readonly issueFeedback?:
    | ((conversationId: string, itemId: string) => Promise<FeedbackHandle>)
    | undefined;
  /**
   * Takes the conversation for this turn, so no second turn runs on it at once; resolves to the
   * release, called once the turn has ended. Throws `rate_limited` when another turn holds it.
   * Set for bots with output checks, whose history depends on each turn's note (ADR-0022).
   */
  readonly lockConversation?:
    | ((conversationId: string) => Promise<() => Promise<void>>)
    | undefined;
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
  console.error(`[askdare] turn failed: ${error.code}`, forLog(error.cause));
}

/** Events that carry the answer's content, held back while output checks run (docs/guardrails.md). */
const HELD: ReadonlySet<ProtocolEvent['type']> = new Set(['text.delta', 'citation', 'tool.ui']);

/** What a failing hook is logged as: its error's name, never its message, which may hold data. */
export function hookError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Streams one chat turn as protocol v1 SSE. Sends a comment before any upstream call (Heroku's
 * 30 s first-byte rule), heartbeats on an independent timer (55 s idle rule), and enforces the
 * bot's turn deadline.
 *
 * A visitor who disconnects stops the stream, not the model: once the model call has started, it
 * runs to completion, so the turn is charged its real usage (an aborted response is gone, usage
 * included) and the answer is waiting in the conversation when they return.
 *
 * With output checks on (`onOutput`, or moderation of output), the answer's text, citations and
 * cards are held back until the turn is complete and checked; progress (reasoning, tool status)
 * still streams. A blocked answer never reaches the client (ADR-0019).
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
      const holding = checksOutput(bot.guardrails);
      const held: ProtocolEvent[] = [];
      // At most four UI payloads per answer, each call once, whatever the gateway sends (ADR-0017).
      const cards = new Set<string>();
      const dropped = new Set<string>();
      const emitTurn = (event: ProtocolEvent): void => {
        if (event.type === 'tool.ui') {
          if (cards.has(event.callId)) return;
          if (cards.size >= MAX_TOOL_UI) {
            if (!dropped.has(event.name)) {
              dropped.add(event.name);
              console.error(
                `[askdare] ui of tool "${event.name}" was dropped: an answer shows at most 4.`,
              );
            }
            return;
          }
          cards.add(event.callId);
        }
        if (holding && HELD.has(event.type)) held.push(event);
        else emit(event);
      };
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
      // The signed-in user when there is one, so abuse is traced to a person across devices.
      const subject = options.context.identity
        ? `user:${options.context.identity.id}`
        : options.visitorId;

      // What the turn did, for its report.
      const startedAt = Date.now();
      let conversationId = options.conversationId;
      let ran = false;
      let steps = 0;
      let model: string | undefined;
      let usage = ZERO_USAGE;
      const tools: ToolCallRecord[] = [];
      let finishReason: MessageEndReason | undefined;
      let outcome: ChatUsageReport['outcome'] = 'completed';
      let errorCode: ErrorCode | undefined;
      let release: (() => Promise<void>) | undefined;

      const guard: GuardOptions = {
        bot,
        gateway,
        context: options.context,
        signal: deadline,
      };

      const run = async (): Promise<void> => {
        // Nothing has been spent upstream yet.
        if (visitorLeft()) return;
        if (conversationId !== undefined && options.lockConversation) {
          release = await options.lockConversation(conversationId);
        }
        // Before a conversation exists: a blocked first message leaves nothing behind.
        const text = checksInput(bot.guardrails)
          ? await guardInput(options.text, options.pageContext, guard)
          : options.text;
        if (visitorLeft()) return;
        if (conversationId === undefined) {
          conversationId = await gateway.createConversation(
            { botId: bot.id, visitorId: options.visitorId },
            deadline,
          );
          // Before its handle leaves the server, so no other turn can reach it first.
          if (options.lockConversation) release = await options.lockConversation(conversationId);
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
        const safetyIdentifier = await options.pseudonym(subject);
        ran = true;
        const result = await gateway.runTurn({
          bot,
          conversationId,
          text,
          attachments: options.attachments ?? [],
          pageContext: options.pageContext,
          context: options.context,
          visitorId: options.visitorId,
          safetyIdentifier,
          messageId,
          signal: deadline,
          emit: emitTurn,
          reserveCall: options.reserveCall,
          onStep: (step) => {
            steps += 1;
            model = step.model ?? model;
            usage = addUsage(usage, step.usage);
          },
          onToolCall: (call) => tools.push(call),
        });
        finishReason = result.reason;
        options.settle?.(result.usage, conversationId);
        const proposed = result.replies && normalizeReplies(result.replies);
        const released = holding ? await releaseAnswer(conversationId, proposed ?? []) : 'allowed';
        const replies = released === 'allowed' ? proposed : undefined;
        // A resumed conversation gets a fresh handle: its 30 days count from the last message.
        // Best effort: the old handle stays valid until it expires.
        const resumeToken = options.conversationId
          ? await options.issueResumeToken(conversationId).catch(() => undefined)
          : undefined;
        // Best effort too: an answer without a handle just can't be rated.
        const feedback =
          result.answerItemId && options.issueFeedback && released === 'allowed'
            ? await options
                .issueFeedback(conversationId, result.answerItemId)
                .catch(() => undefined)
            : undefined;
        if (replies) emit({ type: 'replies', messageId, items: replies });
        emit({
          type: 'message.end',
          messageId,
          reason: result.reason,
          ...(resumeToken ? { resumeToken } : {}),
          ...(feedback ? { feedback } : {}),
        });
      };

      /**
       * Checks the held answer, notes the verdict in the conversation and sends what passed: the
       * answer as it was, or the replacement alone (no cards, and the caller drops the options:
       * they came with the answer the checks rejected). A blocked answer throws. History shows an
       * answer only once its note is stored (ADR-0022), so a failed note hides it on reload.
       */
      const releaseAnswer = async (
        id: string,
        replies: readonly string[],
      ): Promise<'allowed' | 'replaced'> => {
        const answer = held.flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []));
        const outcome = await guardOutput(answer.join(''), replies, guard);
        const noted = (
          gateway.settleAnswer?.(
            id,
            outcome.action === 'allow'
              ? { action: 'allowed' }
              : outcome.action === 'redact'
                ? { action: 'replaced', text: outcome.text }
                : { action: 'withheld' },
            deadline,
          ) ?? Promise.resolve()
        ).catch((error: unknown) => {
          console.error(
            `[askdare] could not note the checked answer in the conversation, so a reload hides it: ${hookError(error)}`,
          );
        });
        if (outcome.action === 'block') {
          await noted;
          throw blockedError(outcome, 'output');
        }
        let replaced = false;
        for (const event of held) {
          if (outcome.action !== 'redact') emit(event);
          else if (event.type === 'citation') emit(event);
          else if (event.type === 'text.delta' && !replaced) {
            emit({ ...event, delta: outcome.text });
            replaced = true;
          }
        }
        held.length = 0;
        await noted;
        return outcome.action === 'redact' ? 'replaced' : 'allowed';
      };

      /** Hands the report to the hook once the stream is closed, so it never delays the answer. */
      const sendReport = async (): Promise<void> => {
        if (!options.report || (!ran && errorCode === undefined)) return;
        try {
          await options.report({
            bot: bot.id,
            model: model ?? bot.model,
            conversation: conversationId
              ? await options.pseudonym(`conversation:${conversationId}`)
              : undefined,
            visitor: await options.pseudonym(subject),
            startedAt,
            durationMs: Date.now() - startedAt,
            outcome,
            ...(finishReason ? { finishReason } : {}),
            ...(errorCode ? { errorCode } : {}),
            usage,
            steps,
            tools,
          });
        } catch (error) {
          console.error(`[askdare] the onUsage hook failed: ${hookError(error)}`);
        }
      };

      const work = run()
        .catch((error: unknown) => {
          if (error instanceof TurnAbortedError) {
            outcome = 'stopped';
            return;
          }
          const failure = deadline.aborted
            ? new AskdareError('timeout', { cause: error })
            : toAskdareError(error);
          outcome = 'failed';
          errorCode = failure.code;
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
        .finally(finish)
        .then(async () => {
          await release?.().catch((error: unknown) => {
            console.error(`[askdare] could not release the conversation: ${hookError(error)}`);
          });
        })
        .then(sendReport);
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
