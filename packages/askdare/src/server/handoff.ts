/**
 * Handoff to a person (ADR-0030) and forms with leads (ADR-0031) on the server: the steps of a
 * handoff for both triggers, the form handles, and a form's submission. Values pass from the
 * request to `onLead` or `onHandoff` and are gone; nothing here logs them, and a hook's failure is
 * reported by its error's class name only, since its message may quote them.
 */
import type { Bot } from '../bot/define-bot';
import {
  formSentNote,
  formShownNote,
  formValuesItem,
  handoffNote,
} from '../conversations/handoff-notes';
import type { FormOrigin } from '../conversations/history';
import type { ConversationStore, StoredItem } from '../conversations/port';
import { AskdareError } from '../errors';
import type { FormFieldSpec } from '../forms/define-form';
import { resolveFormText } from '../forms/form-text';
import type { ChatLeadReport } from '../forms/lead-report';
import { validateForm } from '../forms/validate';
import type { TurnHandoff } from '../gateway';
import {
  type ChatHandoffMessage,
  type ChatHandoffReport,
  HANDOFF_DEADLINE_MS,
} from '../handoff/report';
import type { Limits } from '../limits/limits';
import type { FormPurpose } from '../protocol/forms';
import type { HandoffForm, HandoffState } from '../protocol/handoff';
import type { VisitorIdentity } from '../security/identity';
import type { FormGrant, TokenService } from '../security/tokens';
import { handoffArguments } from '../tools/handoff';
import type { AdminWriter } from './admin-records';
import { hookError } from './stream-turn';

/** How long `handoff.available` has (ADR-0030, decision 3). */
const AVAILABILITY_TIMEOUT_MS = 2_000;
/** What a transcript in a handoff report holds at most (ADR-0030, decision 4). */
const TRANSCRIPT_MESSAGES = 50;
const TRANSCRIPT_BYTES = 64 * 1024;

type FinalState = Exclude<HandoffState, 'requested'>;
type Reason = ChatHandoffReport['reason'];

/** Who a handoff or a form is for: the session's visitor, as the handler verified them. */
export interface HandoffVisitor {
  readonly visitorId: string;
  /** The signed-in user's key (ADR-0009), which the conversation may be bound to. */
  readonly key: string | undefined;
  readonly identity: VisitorIdentity | undefined;
  readonly locale: string;
  readonly clientIp: string;
}

export interface HandoffsConfig {
  readonly limits: Limits;
  readonly conversations: ConversationStore;
  readonly onHandoff?: ((report: ChatHandoffReport) => void | Promise<void>) | undefined;
  readonly onLead?: ((report: ChatLeadReport) => void | Promise<void>) | undefined;
  readonly onError: (error: AskdareError) => void;
  readonly waitUntil?: ((work: Promise<unknown>) => void) | undefined;
  readonly admin?: AdminWriter | undefined;
  /** The visible messages of the conversation's latest history page, for `content: 'transcript'`. */
  readonly transcript: (bot: Bot, conversationId: string) => Promise<readonly ChatHandoffMessage[]>;
}

/** The answer of a form's submission, before it becomes a response. */
export type FormSubmission =
  | { readonly kind: 'sent'; readonly handoff?: FinalState | undefined }
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'already_sent' }
  | { readonly kind: 'gone' };

interface Start {
  readonly trigger: 'model' | 'visitor';
  readonly reason: Reason;
  readonly summary?: string | undefined;
  readonly callId: string;
}

/** Runs `work` with a deadline; false when it threw or ran out of time. */
async function within(
  deadlineMs: number,
  work: () => unknown,
  onFailure: (error: unknown) => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HandoffTimeoutError()), deadlineMs);
  });
  try {
    await Promise.race([Promise.resolve().then(work), timeout]);
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

class HandoffTimeoutError extends Error {
  override readonly name = 'HandoffTimeoutError';
}

/** The last messages that fit the report's caps, oldest first; the oldest are cut first. */
export function capTranscript(messages: readonly ChatHandoffMessage[]): ChatHandoffMessage[] {
  const kept: ChatHandoffMessage[] = [];
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const message of messages.toReversed()) {
    if (kept.length >= TRANSCRIPT_MESSAGES) break;
    bytes += encoder.encode(message.text).byteLength;
    if (bytes > TRANSCRIPT_BYTES) break;
    kept.push({ role: message.role, text: message.text });
  }
  return kept.reverse();
}

/** A form's `toModel` values as `label: value` lines, in the visitor's language. */
function toModelLines(
  fields: readonly FormFieldSpec[],
  values: Readonly<Record<string, string | boolean>>,
  locale: string,
): [string, string][] {
  return fields.flatMap((field): [string, string][] => {
    const value = values[field.name];
    if (!field.toModel || value === undefined || value === '') return [];
    const text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value;
    return [[resolveFormText(field.label, locale), text]];
  });
}

type HandoffResult = { readonly state: HandoffState; readonly form?: HandoffForm | undefined };

export interface Handoffs {
  /** What a turn needs to run the model's `handoff` calls; undefined when the model can't. */
  forTurn(
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
  ): Promise<TurnHandoff | undefined>;
  /** Issues the handle of a form the model showed. */
  showForm(
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    name: string,
    callId: string,
  ): Promise<{ readonly handle: string }>;
  /**
   * The visitor's "Talk to a person" (`POST /handoff`): the same steps with `visitor_asked`,
   * recorded in the conversation as notes, since no model call holds them.
   */
  fromVisitor(
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
  ): Promise<HandoffResult>;
  /** A fresh handle for a form that is still open after a reload; undefined when it can't be. */
  reissue(
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    form: { readonly callId: string; readonly name: string; readonly purpose: FormPurpose },
    origin: FormOrigin['handoff'],
  ): Promise<string | undefined>;
  /**
   * A form's submission (ADR-0031, decision 4), after the handler checked the session, the
   * handle and the limits: validation, the one-time claim, then `onLead` or the handoff.
   */
  submit(
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    grant: FormGrant,
    values: unknown,
  ): Promise<FormSubmission>;
}

export function createHandoffs(config: HandoffsConfig): Handoffs {
  const reportHook = (name: string, error: unknown): void => {
    // The class name only: a transport's or a CRM's message can quote what it was sending.
    config.onError(
      new AskdareError('internal_error', {
        message: `The ${name} hook failed: ${hookError(error)}.`,
      }),
    );
  };

  const subjectOf = (visitor: HandoffVisitor): string =>
    visitor.identity ? `user:${visitor.identity.id}` : visitor.visitorId;

  /** The handoff's ID: the same for every retry of one handoff, from the call it came from. */
  const handoffId = async (tokens: TokenService, conversationId: string, callId: string) =>
    `ho_${(await tokens.pseudonym(`handoff:${conversationId}:${callId}`)).slice(0, 32)}`;

  const count = (bot: Bot, state: FinalState): void => {
    const writer = config.admin;
    if (!writer) return;
    const work = writer.count({
      kind: 'handoff',
      bot: bot.id,
      at: Date.now(),
      source: 'chat',
      state,
    });
    config.waitUntil?.(work);
  };

  /** Best effort: a note that fails loses the state after a reload, never the handoff. */
  const note = async (conversationId: string, items: readonly StoredItem[]): Promise<void> => {
    try {
      await config.conversations.append(conversationId, items);
    } catch (error) {
      console.error(
        `[askdare] could not note the handoff or form in the conversation: ${hookError(error)}`,
      );
    }
  };

  const available = async (bot: Bot, visitor: HandoffVisitor): Promise<boolean> => {
    const check = bot.handoff?.available;
    if (!check) return true;
    let result = false;
    const answered = await within(
      AVAILABILITY_TIMEOUT_MS,
      async () => {
        result =
          (await check({ bot: bot.id, locale: visitor.locale, identity: visitor.identity })) ===
          true;
      },
      (error) => reportHook('handoff.available', error),
    );
    return answered && result;
  };

  /** Hands the report to `onHandoff` within its deadline: whether it arrived. */
  const deliver = async (report: ChatHandoffReport): Promise<boolean> => {
    const hook = config.onHandoff;
    if (!hook) return false;
    return within(
      HANDOFF_DEADLINE_MS,
      () => hook(report),
      (error) => reportHook('onHandoff', error),
    );
  };

  /** Hands a lead to `onLead`; `await` decides whether its outcome is waited for. */
  const lead = async (report: ChatLeadReport): Promise<boolean> => {
    const hook = config.onLead;
    if (!hook) return false;
    return within(
      HANDOFF_DEADLINE_MS,
      () => hook(report),
      (error) => reportHook('onLead', error),
    );
  };

  const handoffReport = async (
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    handoff: {
      readonly id: string;
      readonly trigger: 'model' | 'visitor';
      readonly reason: Reason;
      readonly summary?: string | undefined;
    },
    extra: {
      readonly available: boolean;
      readonly contact?: Readonly<Record<string, string | boolean>> | undefined;
    },
  ): Promise<ChatHandoffReport> => {
    const content = bot.handoff?.content ?? 'none';
    const summary = content !== 'none' ? handoff.summary : undefined;
    let transcript: readonly ChatHandoffMessage[] | undefined;
    if (content === 'transcript') {
      try {
        transcript = capTranscript(await config.transcript(bot, conversationId));
      } catch (error) {
        console.error(`[askdare] could not read the transcript for a handoff: ${hookError(error)}`);
      }
    }
    return {
      id: handoff.id,
      bot: bot.id,
      locale: visitor.locale,
      createdAt: Date.now(),
      trigger: handoff.trigger,
      reason: handoff.reason,
      visitor: await tokens.pseudonym(subjectOf(visitor)),
      ...(visitor.identity ? { identity: visitor.identity } : {}),
      conversationId,
      available: extra.available,
      ...(extra.contact ? { contact: extra.contact } : {}),
      ...(summary ? { summary } : {}),
      ...(transcript ? { transcript } : {}),
    };
  };

  /** A form's handle for this visitor and conversation. */
  const formHandle = async (
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    grant: Pick<FormGrant, 'callId' | 'form' | 'purpose' | 'handoff'>,
  ): Promise<string> =>
    (
      await tokens.issueForm(bot.id, {
        visitorId: visitor.visitorId,
        ...(visitor.key ? { identityKey: visitor.key } : {}),
        conversationId,
        locale: visitor.locale,
        ...grant,
      })
    ).token;

  /**
   * The steps of a handoff for both triggers (ADR-0030, decision 3): limits, availability, the
   * contact form, delivery. Resolves to the final state, or `requested` with the form to fill in.
   * Never throws for the hook's sake: a failure is a state.
   */
  const start = async (
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    request: Start,
  ): Promise<HandoffResult> => {
    const handoff = bot.handoff;
    const finish = (state: FinalState) => {
      count(bot, state);
      return { state };
    };
    if (!handoff) return { state: 'unavailable' };
    const taken = await config.limits.takeHandoff(bot, {
      conversationId,
      subject: visitor.key ?? visitor.visitorId,
      clientIp: visitor.clientIp,
    });
    if (!taken) return finish('limited');
    const open = await available(bot, visitor);
    const id = await handoffId(tokens, conversationId, request.callId);
    const email = visitor.identity?.email;
    if (handoff.form && (!open || !email)) {
      const purpose: Extract<FormPurpose, 'handoff' | 'message'> = open ? 'handoff' : 'message';
      const handle = await formHandle(tokens, bot, visitor, conversationId, {
        callId: request.callId,
        form: handoff.form.name,
        purpose,
        handoff: {
          id,
          reason: request.reason,
          trigger: request.trigger,
          ...(request.summary ? { summary: request.summary } : {}),
        },
      });
      return { state: 'requested', form: { name: handoff.form.name, handle, purpose } };
    }
    if (!open) return finish('unavailable');
    const report = await handoffReport(
      tokens,
      bot,
      visitor,
      conversationId,
      { id, ...request },
      {
        available: true,
        ...(email ? { contact: { email } } : {}),
      },
    );
    return finish((await deliver(report)) ? 'sent' : 'failed');
  };

  return {
    async forTurn(tokens, bot, visitor, conversationId) {
      if (!bot.handoff?.model) return undefined;
      const offered = await config.limits.handoffsLeft(bot, conversationId);
      return {
        offered,
        run: async (call) => {
          const args = handoffArguments(call.arguments);
          try {
            return await start(tokens, bot, visitor, conversationId, {
              trigger: 'model',
              reason: args.reason,
              summary: args.summary,
              callId: call.callId,
            });
          } catch (error) {
            // A limit store or token failure: the turn goes on, and the model hears it failed.
            reportHook('handoff', error);
            return { state: 'failed' };
          }
        },
      };
    },

    async showForm(tokens, bot, visitor, conversationId, name, callId) {
      return {
        handle: await formHandle(tokens, bot, visitor, conversationId, {
          callId,
          form: name,
          purpose: 'lead',
        }),
      };
    },

    async fromVisitor(tokens, bot, visitor, conversationId) {
      const callId = `hv_${crypto.randomUUID().replaceAll('-', '')}`;
      const result = await start(tokens, bot, visitor, conversationId, {
        trigger: 'visitor',
        reason: 'visitor_asked',
        callId,
      });
      await note(
        conversationId,
        result.form
          ? [
              formShownNote(result.form.name, callId, result.form.purpose, visitor.locale),
              handoffNote('requested', callId),
            ]
          : [handoffNote(result.state)],
      );
      return result;
    },

    async reissue(tokens, bot, visitor, conversationId, form, origin) {
      if (!bot.forms.some((each) => each.name === form.name)) return undefined;
      if (form.purpose === 'lead') {
        return formHandle(tokens, bot, visitor, conversationId, {
          callId: form.callId,
          form: form.name,
          purpose: 'lead',
        });
      }
      if (!origin || !bot.handoff) return undefined;
      return formHandle(tokens, bot, visitor, conversationId, {
        callId: form.callId,
        form: form.name,
        purpose: form.purpose,
        handoff: { id: await handoffId(tokens, conversationId, form.callId), ...origin },
      });
    },

    async submit(tokens, bot, visitor, grant, values) {
      const form = bot.forms.find((each) => each.name === grant.form);
      const handoff = grant.purpose === 'lead' ? undefined : grant.handoff;
      if (!form || (grant.purpose !== 'lead' && (!handoff || !bot.handoff)))
        return { kind: 'gone' };
      const checked = validateForm(form, values);
      if (!checked.ok) return { kind: 'invalid', fields: checked.fields };
      const claim = await config.limits.claimForm(
        await tokens.pseudonym(`form:${grant.conversationId}:${grant.callId}`),
      );
      if (!claim) return { kind: 'already_sent' };
      const { conversationId, callId, locale } = grant;
      const reporter = { ...visitor, locale };
      try {
        const leadReport = async (source: ChatLeadReport['source']): Promise<ChatLeadReport> => ({
          id: `ld_${crypto.randomUUID().replaceAll('-', '')}`,
          bot: bot.id,
          form: form.name,
          locale,
          createdAt: Date.now(),
          values: checked.values,
          visitor: await tokens.pseudonym(subjectOf(visitor)),
          ...(visitor.identity ? { identity: visitor.identity } : {}),
          conversationId,
          source,
        });
        const sent: StoredItem[] = [formSentNote(form.name, callId)];
        const lines = toModelLines(form.fields, checked.values, locale);
        const values = lines.length > 0 ? [formValuesItem(lines)] : [];
        if (!handoff) {
          await note(conversationId, [...sent, ...values]);
          // After the response, like `onFeedback`: a slow CRM doesn't delay the visitor's "done".
          const work = (async () => {
            if (await lead(await leadReport({ kind: 'model' }))) {
              await config.admin?.count({
                kind: 'lead',
                bot: bot.id,
                at: Date.now(),
                source: 'chat',
              });
            }
          })().catch((error: unknown) => reportHook('onLead', error));
          config.waitUntil?.(work);
          return { kind: 'sent' };
        }
        const unavailable = grant.purpose === 'message';
        let state: FinalState;
        const saved = async (why: 'unavailable' | 'failed'): Promise<boolean> =>
          lead(
            await leadReport({
              kind: 'handoff',
              reason: handoff.reason,
              trigger: handoff.trigger,
              delivered: false,
              why,
            }),
          );
        const report = (availableNow: boolean) =>
          handoffReport(tokens, bot, reporter, conversationId, handoff, {
            available: availableNow,
            contact: checked.values,
          });
        if (!unavailable) {
          state = (await deliver(await report(true)))
            ? 'sent'
            : config.onLead && (await saved('failed'))
              ? 'saved'
              : 'failed';
        } else if (config.onLead) {
          state = (await saved('unavailable')) ? 'saved' : 'failed';
        } else {
          state = (await deliver(await report(false))) ? 'saved' : 'failed';
        }
        count(bot, state);
        // The values right after the sent note, which is where the history looks for them.
        await note(conversationId, [...sent, ...values, handoffNote(state, callId)]);
        return { kind: 'sent', handoff: state };
      } catch (error) {
        await claim.release().catch(() => undefined);
        throw error;
      }
    },
  };
}
