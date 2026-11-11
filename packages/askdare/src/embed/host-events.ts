import type { ChatEvent, ChatEventType } from '../chat/events';

/** Each event type's fields besides `type` and `bot`; the compiler keeps it in step with ChatEvent. */
type Fields = {
  readonly [T in ChatEventType]: Readonly<
    Record<Exclude<keyof Extract<ChatEvent, { type: T }>, 'type' | 'bot'>, 1>
  >;
} & { readonly open: Readonly<Record<never, 1>>; readonly close: Readonly<Record<never, 1>> };

/**
 * The chat events the loader passes on to the page (ADR-0013), checked again on this side: the
 * page gets only known types and fields, each a number, a boolean, null or a short code, so the
 * chat can't hand the page text, IDs or tokens even by mistake.
 */
const FIELDS: Fields = {
  ready: {},
  open: {},
  close: {},
  'message.sent': { length: 1, attachments: 1, source: 1 },
  'message.received': { outcome: 1, durationMs: 1, citations: 1 },
  feedback: { rating: 1, commented: 1 },
  error: { code: 1 },
  'conversation.reset': {},
};

export type HostEvent = { readonly type: string; readonly bot: string } & Readonly<
  Record<string, string | number | boolean | null>
>;

export type HostEventListener = (event: HostEvent) => void;

/** A copy of the event with the loader's own bot ID, or undefined for anything unexpected. */
export function hostEvent(data: unknown, bot: string): HostEvent | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const input = data as Record<string, unknown>;
  const type = input['type'];
  if (typeof type !== 'string' || !Object.hasOwn(FIELDS, type)) return undefined;
  const event: Record<string, string | number | boolean | null> = { type, bot };
  for (const field of Object.keys(FIELDS[type as keyof Fields])) {
    const value = input[field];
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && /^[a-z_]{1,40}$/.test(value))
    ) {
      event[field] = value;
    } else if (value !== undefined) {
      return undefined;
    }
  }
  return event as HostEvent;
}
