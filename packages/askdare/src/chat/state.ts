import type { FeedbackHandle } from '../protocol/events';
import type { FormFieldErrors, FormPurpose } from '../protocol/forms';
import type { HandoffState } from '../protocol/handoff';
import type { ToolUi } from '../protocol/tool-ui';
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
  /**
   * Options the visitor can click instead of typing (ADR-0015); plain text. Shown only while this
   * is the latest message; a click sends the option as the visitor's own message.
   */
  readonly replies?: readonly string[] | undefined;
  /**
   * What the turn's tools picked from their results for the visitor to see (ADR-0017), in call
   * order, at most four: plain JSON for the components registered with `toolRenderers`.
   */
  readonly ui?: readonly ToolUi[] | undefined;
  /**
   * A handoff to a person recorded after this answer (ADR-0030): `requested` while it runs or its
   * form waits, then its final state. Shown as plain text.
   */
  readonly handoff?: HandoffState | undefined;
  /** Forms shown under this answer, in order (ADR-0031); each stays until it is sent or expires. */
  readonly forms?: readonly MessageForm[] | undefined;
}

/**
 * A form under an answer (ADR-0031). Its fields, title and texts are in `ChatConfig.forms`, found by
 * `name`. `open` takes values, `submitting` while they go out, then `sent` (show its `done` text,
 * or the message's handoff state) or `expired` (its handle is no longer valid).
 */
export interface MessageForm {
  /** Opaque, unique in the conversation. */
  readonly callId: string;
  readonly name: string;
  /** Picks the texts around the form: a lead, a handoff's contact details, or a message left. */
  readonly purpose: FormPurpose;
  readonly state: 'open' | 'submitting' | 'sent' | 'expired';
  /** What `actions.submitForm` takes, while the form is open. */
  readonly handle?: string | undefined;
  /**
   * The fields the server refused at the last try, each with an error key (`error.form.required`,
   * `error.form.email`…) to look up with `t`. A key the chat doesn't know is a generic error.
   */
  readonly errors?: FormFieldErrors | undefined;
  /** Why the last try failed as a whole, such as a lost connection, in the visitor's language. */
  readonly error?: string | undefined;
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

/**
 * Whether the stored conversation has older messages than those shown: `more` (load them with
 * `actions.loadEarlier()`), `loading` while they load, or `none` (the start is shown, or there is
 * no stored conversation).
 */
export type Earlier = 'none' | 'more' | 'loading';

export interface ChatState {
  readonly phase: ChatPhase;
  /** A turn, or deleting the conversation, is under way. */
  readonly busy: boolean;
  readonly messages: readonly ChatMessage[];
  /** Older messages of the stored conversation, loaded a page at a time from the newest. */
  readonly earlier: Earlier;
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
  /** The chat waits for the visitor to pass the bot's human check before it connects. */
  readonly humanCheck: boolean;
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
