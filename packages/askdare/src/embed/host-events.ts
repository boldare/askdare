/**
 * The chat events the loader passes on to the page (ADR-0013), checked again on this side: the
 * page gets only known types and fields, each a number, a boolean, null or a short code, so the
 * chat can't hand the page text, IDs or tokens even by mistake.
 */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  ready: [],
  open: [],
  close: [],
  'message.sent': ['length', 'attachments', 'source'],
  'message.received': ['outcome', 'durationMs', 'citations'],
  feedback: ['rating', 'commented'],
  error: ['code'],
  'conversation.reset': [],
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
  const fields = typeof type === 'string' && Object.hasOwn(FIELDS, type) ? FIELDS[type] : undefined;
  if (!fields) return undefined;
  const event: Record<string, string | number | boolean | null> = { type: type as string, bot };
  for (const field of fields) {
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

/** The page's listeners, by event type or '*' for all; one that throws doesn't stop the others. */
export function hostListeners(): {
  on(type: string, listener: HostEventListener): () => void;
  off(type: string, listener: HostEventListener): void;
  emit(event: HostEvent): void;
} {
  const listeners: [string, HostEventListener][] = [];
  const off = (type: string, listener: HostEventListener): void => {
    const index = listeners.findIndex(([t, l]) => t === type && l === listener);
    if (index >= 0) listeners.splice(index, 1);
  };
  return {
    on(type, listener) {
      if (typeof type === 'string' && typeof listener === 'function') {
        listeners.push([type, listener]);
      } else {
        console.warn("[askdare] askdare('on') expects an event type and a function.");
      }
      return () => off(type, listener);
    },
    off,
    emit(event) {
      // One listener can't change what the next one gets.
      Object.freeze(event);
      for (const [type, listener] of [...listeners]) {
        if (type !== '*' && type !== event.type) continue;
        try {
          listener(event);
        } catch {
          console.warn(`[askdare] A listener for "${event.type}" threw.`);
        }
      }
    },
  };
}
