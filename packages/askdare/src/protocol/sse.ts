import { PROTOCOL_EVENT_TYPES, type ProtocolEvent } from './events';
import { parseEvent } from './validate';

/** One event as framed on the wire, before protocol validation. */
export interface RawSseEvent {
  readonly event: string;
  readonly data: string;
}

export type DecodeResult =
  | { readonly ok: true; readonly event: ProtocolEvent }
  | {
      readonly ok: false;
      readonly reason: 'unknown_type' | 'invalid_json' | 'invalid_payload';
      readonly type: string;
    };

/** Frames a protocol event for the wire. JSON never contains raw newlines, so one data line suffices. */
export function encodeEvent(event: ProtocolEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Frames an SSE comment, used for the first byte and heartbeats. Clients ignore it. */
export function encodeComment(text: string): string {
  return `: ${text.replaceAll(/[\r\n]/g, ' ')}\n\n`;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(PROTOCOL_EVENT_TYPES);

/**
 * Validates a framed event against the protocol. Unknown event types are reported, not thrown,
 * so older clients keep working when newer servers add events.
 */
export function decodeEvent(raw: RawSseEvent): DecodeResult {
  if (!KNOWN_TYPES.has(raw.event)) {
    return { ok: false, reason: 'unknown_type', type: raw.event };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.data);
  } catch {
    return { ok: false, reason: 'invalid_json', type: raw.event };
  }
  const event = parseEvent(json);
  if (!event || event.type !== raw.event) {
    return { ok: false, reason: 'invalid_payload', type: raw.event };
  }
  return { ok: true, event };
}

/**
 * Incremental parser for `text/event-stream`, following the WHATWG framing rules: any line ending
 * (CRLF, LF, CR), comments, multi-line `data`, and dispatch on a blank line. Fields other than
 * `event` and `data` are ignored. An unterminated event at end of stream is discarded.
 */
export class SseParser {
  #buffer = '';
  #pendingCr = false;
  #started = false;
  #eventType = '';
  #dataLines: string[] = [];

  /** Feeds a decoded text chunk and returns the events completed by it. */
  push(chunk: string): RawSseEvent[] {
    let text = chunk;
    if (!this.#started && text.length > 0) {
      this.#started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    if (this.#pendingCr && text.startsWith('\n')) text = text.slice(1);
    this.#pendingCr = false;

    this.#buffer += text;
    const events: RawSseEvent[] = [];
    let lineStart = 0;
    for (let i = 0; i < this.#buffer.length; i += 1) {
      const char = this.#buffer[i];
      if (char !== '\n' && char !== '\r') continue;
      const line = this.#buffer.slice(lineStart, i);
      if (char === '\r') {
        if (i + 1 === this.#buffer.length) this.#pendingCr = true;
        else if (this.#buffer[i + 1] === '\n') i += 1;
      }
      lineStart = i + 1;
      const event = this.#processLine(line);
      if (event) events.push(event);
    }
    this.#buffer = this.#buffer.slice(lineStart);
    return events;
  }

  #processLine(line: string): RawSseEvent | undefined {
    if (line === '') return this.#dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.#eventType = value;
    else if (field === 'data') this.#dataLines.push(value);
    return undefined;
  }

  #dispatch(): RawSseEvent | undefined {
    const hasData = this.#dataLines.length > 0;
    const event: RawSseEvent = {
      event: this.#eventType === '' ? 'message' : this.#eventType,
      data: this.#dataLines.join('\n'),
    };
    this.#eventType = '';
    this.#dataLines = [];
    return hasData ? event : undefined;
  }
}
