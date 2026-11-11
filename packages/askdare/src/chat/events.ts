import type { ErrorCode } from '../protocol/events';
import type { Rating } from './state';

/**
 * What happened in the chat, for the page's analytics and reactions (ADR-0013). Metadata only:
 * never message text, comments, file names, IDs or tokens, because analytics scripts on the page
 * are third parties. New types and fields may come in a minor release; listeners ignore the rest.
 */
export type ChatEvent =
  /** The chat can take messages: signed in and the stored conversation, if any, is loaded. */
  | { readonly type: 'ready'; readonly bot: string }
  /**
   * The visitor sent a message. `length` counts its characters; `source` says whether it was typed
   * (or dictated) into the field or picked from the suggested questions.
   */
  | {
      readonly type: 'message.sent';
      readonly bot: string;
      readonly length: number;
      readonly attachments: number;
      readonly source: 'typed' | 'starter';
    }
  /** The answer ended: in full, stopped (the chat closed mid-answer) or with an error. */
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
 * Listeners for chat events. A listener that throws can't break the chat: it is logged in one
 * line, without details, and the others still run.
 */
export function chatEvents(): {
  emit(event: ChatEvent): void;
  listen(listener: ChatEventListener): () => void;
} {
  const listeners = new Set<ChatEventListener>();
  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          console.warn(`[askdare] A listener for "${event.type}" threw.`);
        }
      }
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
