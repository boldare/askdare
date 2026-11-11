import type { ErrorCode } from '../protocol/events';
import type { Rating } from './state';

/**
 * What happened in the chat, for the page's analytics and reactions (ADR-0013). Metadata only:
 * never message text, comments, file names, IDs or tokens, because analytics scripts on the page
 * are third parties. New types and fields may come in a minor release; listeners ignore the rest.
 */
export type ChatEvent =
  /**
   * The chat can take messages: signed in and the stored conversation, if any, loaded. Fires once
   * per chat, and not while loading the conversation fails.
   */
  | { readonly type: 'ready'; readonly bot: string }
  /**
   * The visitor sent a message. `length` counts its characters (code points); `source` says
   * whether it was typed (or dictated) into the field or picked from the suggested questions.
   */
  | {
      readonly type: 'message.sent';
      readonly bot: string;
      readonly length: number;
      readonly attachments: number;
      readonly source: 'typed' | 'starter';
    }
  /**
   * The answer ended: in full, with an error, or stopped because the chat was taken down
   * mid-answer (a React `Root` unmounting). Closing the widget's panel doesn't stop an answer.
   */
  | {
      readonly type: 'message.received';
      readonly bot: string;
      readonly outcome: 'completed' | 'stopped' | 'failed';
      readonly durationMs: number;
      readonly citations: number;
    }
  /** The visitor rated an answer, or took the rating back (`null`). */
  | {
      readonly type: 'feedback';
      readonly bot: string;
      readonly rating: Rating | null;
      readonly commented: boolean;
    }
  /** A turn failed with this code; the chat shows the visitor why. */
  | { readonly type: 'error'; readonly bot: string; readonly code: ErrorCode }
  /** The visitor started a new conversation. */
  | { readonly type: 'conversation.reset'; readonly bot: string };

export type ChatEventType = ChatEvent['type'];

export type ChatEventListener = (event: ChatEvent) => void;

/**
 * Listeners by event type, or '*' for every type; used by the chat store and by the loader on the
 * host page. Each event is frozen, so one listener can't change what the next one gets. A listener
 * that throws can't break the chat: it is logged in one line, without details, and the others
 * still run.
 */
export function eventListeners<E extends { readonly type: string }>(): {
  on(type: string, listener: (event: E) => void): () => void;
  off(type: string, listener: (event: E) => void): void;
  emit(event: E): void;
} {
  const listeners: [string, (event: E) => void][] = [];
  const off = (type: string, listener: (event: E) => void): void => {
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
