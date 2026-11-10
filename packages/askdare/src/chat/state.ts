import type { FeedbackHandle } from '../protocol/events';
import type { PageOptions } from './page-options';

export interface Citation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

export interface SentFile {
  readonly name: string;
  readonly kind: 'image' | 'pdf';
  /** Local preview of an image sent in this session; history only knows how many files there were. */
  readonly previewUrl?: string | undefined;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly Citation[];
  /** Number of files, from history. */
  readonly attachments: number;
  /** Files sent in this session. */
  readonly files?: readonly SentFile[];
  readonly status: 'streaming' | 'done' | 'error';
  /** On answers the visitor may rate: `key` is where `ChatState.ratings` keeps their rating. */
  readonly feedback?: FeedbackHandle | undefined;
}

export type Rating = 'up' | 'down';

/** A file picked for the next message. */
export interface PendingFile {
  readonly key: string;
  readonly name: string;
  readonly kind?: 'image' | 'pdf' | undefined;
  readonly previewUrl?: string | undefined;
  readonly status: 'uploading' | 'ready' | 'error';
  readonly handle?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * `starting` until the chat knows who the visitor is (and on the server), `loading` while a stored
 * conversation loads, then `ready`.
 */
export type ChatPhase = 'starting' | 'loading' | 'ready';

export type Dictation = 'idle' | 'recording' | 'transcribing';

export interface ChatState {
  readonly phase: ChatPhase;
  /** A turn, or deleting the conversation, is under way. */
  readonly busy: boolean;
  readonly messages: readonly ChatMessage[];
  readonly draft: string;
  readonly error: string | undefined;
  /** What the assistant is doing while no text streams, such as searching documents. */
  readonly activity: string | null;
  readonly files: readonly PendingFile[];
  readonly dictation: Dictation;
  /** Seconds of the current dictation. */
  readonly elapsed: number;
  /** Whether this browser can record (and the bot has voice input). False on the server. */
  readonly canDictate: boolean;
  /** Greeting, starters and context set by the page. */
  readonly page: PageOptions;
  /** The visitor's own ratings of answers, by `ChatMessage.feedback.key`; kept in this browser. */
  readonly ratings: Readonly<Record<string, Rating>>;
  /** The id of the answer just rated 👎, while the chat asks what went wrong. */
  readonly commenting: string | undefined;
}

/** Whether the draft, or the files ready to go, can be sent now. */
export function canSend(state: ChatState): boolean {
  return (
    state.phase === 'ready' &&
    !state.busy &&
    !state.files.some((file) => file.status === 'uploading') &&
    (state.draft.trim() !== '' || state.files.some((file) => file.status === 'ready'))
  );
}
