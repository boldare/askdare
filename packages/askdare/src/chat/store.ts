import type { TextKey } from '../i18n/texts';
import type { ErrorCode, ProtocolEvent } from '../protocol/events';
import type { FormFieldErrors } from '../protocol/forms';
import type { HandoffState } from '../protocol/handoff';
import { parseEvent } from '../protocol/validate';
import { ChatClient, SessionRefused } from './chat-client';
import type { ChatConfig } from './config';
import { type ChatEvent, type ChatEventListener, eventListeners } from './events';
import type { PageOptions } from './page-options';
import { prepareFile } from './prepare-file';
import { canRecord, MicrophoneError, type Recording, startRecording } from './recorder';
import {
  activityFor,
  applyEvent,
  changeForm,
  failStreaming,
  fromHistory,
  type Translate,
  translator,
} from './reducer';
import {
  type ChatState,
  canSend,
  type MessageForm,
  type PendingFile,
  type Rating,
  type SentFile,
} from './state';
import { browserStorage } from './storage';

/** What visitors can do in the chat; the same for every UI on top of the store. */
export interface ChatActions {
  /**
   * Sends the draft with the files that are ready, or `text` (a starter, or one of the latest
   * answer's `replies`) on its own.
   */
  send(text?: string): Promise<void>;
  setDraft(text: string): void;
  /** Uploads files for the next message, as many as the bot allows. */
  addFiles(files: readonly File[]): void;
  removeFile(key: string): void;
  startDictation(): Promise<void>;
  /** Stops the dictation and puts the transcript into the draft. */
  finishDictation(): Promise<void>;
  cancelDictation(): void;
  /** Deletes the conversation and starts with an empty chat. */
  newConversation(): Promise<void>;
  /**
   * Loads the page of older messages before those shown, while `state.earlier` is `more`, and
   * puts it above them.
   */
  loadEarlier(): Promise<void>;
  /**
   * Rates an answer by its message id: 👍, 👎, or null to take the rating back. After 👎 the chat
   * asks what went wrong (`state.commenting`); pass the answer as `comment` with the same rating.
   */
  rate(messageId: string, rating: Rating | null, comment?: string): Promise<void>;
  /**
   * Asks for a person (ADR-0030), for the latest answer: its `handoff` is `requested` while the
   * request runs, then the final state, or `requested` with a form to fill in under it first.
   * Does nothing before the first answer or while a handoff runs.
   */
  handoff(): Promise<void>;
  /**
   * Sends the values of an open form by its `handle` (ADR-0031): text by field name, `true` or
   * `false` for a `consent`. The form is `submitting`, then `sent`, or `open` again with `errors`
   * per field or an `error`.
   */
  submitForm(handle: string, values: Readonly<Record<string, string | boolean>>): Promise<void>;
  /** Closes the question after 👎 without a comment. */
  dismissComment(): void;
  /** Moves keyboard focus to the message field, wherever focus is now. */
  focus(): void;
}

/** Where the chat wants keyboard focus: the message field, or the dictation's Done button. */
export type FocusTarget = 'input' | 'dictation';

export interface StartOptions {
  /** Settles when the page's identity is known; the first request waits for it. */
  readonly handshake?: Promise<void>;
}

export interface ChatStore {
  readonly config: ChatConfig;
  readonly actions: ChatActions;
  readonly t: Translate;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatState;
  /** The state rendered on the server and while hydrating: always the initial one. */
  getServerSnapshot(): ChatState;
  /** Connects the chat: reads storage, signs in, loads the stored conversation. Idempotent. */
  start(options?: StartOptions): void;
  /** Stops anything live: the turn being answered, uploads and a dictation. `start()` may run again. */
  stop(): void;
  /** Signs the visitor in with a token from the site's backend, or out with null (ADR-0009). */
  identify(token: string | null): void;
  configure(page: PageOptions): void;
  /**
   * Switches the chat's language in place (ADR-0014, step 2): new texts and locale, while the
   * messages, the draft and an answer under way stay. Uses the texts of `config` when given (a
   * chat inside a page gets them from `getChatConfig`), else fetches them from the route. Resolves
   * false, keeping the current texts, when they can't be loaded or a later switch overtook it.
   */
  setLocale(locale: string, config?: ChatConfig): Promise<boolean>;
  /** The language the chat's texts are written in, for a document's `lang`; set by `setLocale`. */
  readonly language: string | undefined;
  /** The chat was hidden: the microphone goes off. */
  hide(): void;
  /**
   * Hands the human check's token to the session waiting for it, or null when the challenge
   * failed. Called by `HumanCheck`.
   */
  answerHumanCheck(token: string | null): void;
  /** `HumanCheck` registers while mounted; returns an unregister. */
  attachHumanCheck(): () => void;
  /** The microphone's loudness from 0 to 1 while recording. */
  level(): number | undefined;
  /**
   * Registers what takes focus for `target`. The listener focuses its element and returns whether
   * it could; a request nobody could take yet goes to the next listener. Returns an unsubscribe.
   */
  onFocus(target: FocusTarget, listener: FocusListener): () => void;
  /** Calls the listener with each chat event (ADR-0013); returns an unsubscribe. */
  onEvent(listener: ChatEventListener): () => void;
}

export interface Recorder {
  canRecord(): boolean;
  startRecording(maxSeconds: number): Promise<Recording>;
}

export interface ChatStoreOptions {
  /** Defaults to a client on `localStorage`. */
  readonly client?: ChatClient;
  readonly recorder?: Recorder;
  /** The page's greeting, starters and context from the start, so the server renders them. */
  readonly page?: PageOptions;
}

/** How long a focus request waits for its element to appear, such as the field after a dictation. */
const FOCUS_WAIT_MS = 2_000;

/**
 * Focuses its element and says whether it handled the request; false when the element is gone.
 * `explicit` is a request of the page or the visitor; otherwise the chat follows its own work
 * (an answer, a transcript) and must not take focus from the page around it.
 */
export type FocusListener = (explicit: boolean) => boolean;

/**
 * Where the chat wants focus next. A request stays pending until a listener for its target really
 * takes it: the message field comes back only after a dictation ends, and a listener whose element
 * has just unmounted must not swallow the request. Only the latest request is kept.
 */
export function focusRequests(): {
  focus(target: FocusTarget, explicit?: boolean): void;
  onFocus(target: FocusTarget, listener: FocusListener): () => void;
} {
  const listeners: Record<FocusTarget, Set<FocusListener>> = {
    input: new Set(),
    dictation: new Set(),
  };
  let pending:
    | { readonly target: FocusTarget; readonly explicit: boolean; readonly at: number }
    | undefined;
  const deliver = (target: FocusTarget, explicit: boolean): boolean => {
    let taken = false;
    for (const listener of listeners[target]) taken = listener(explicit) || taken;
    return taken;
  };
  return {
    focus(target, explicit = false) {
      pending = deliver(target, explicit) ? undefined : { target, explicit, at: Date.now() };
    },
    onFocus(target, listener) {
      listeners[target].add(listener);
      // Only while it is fresh: an element that appears much later must not grab focus.
      const fresh = pending?.target === target && Date.now() - pending.at < FOCUS_WAIT_MS;
      if (fresh && listener(pending?.explicit ?? false)) pending = undefined;
      return () => listeners[target].delete(listener);
    },
  };
}

const MICROPHONE_MESSAGES: Readonly<Record<MicrophoneError['reason'], TextKey>> = {
  blocked: 'microphone.blocked',
  missing: 'microphone.missing',
  failed: 'microphone.failed',
};

/** As the server's limit for a rating's comment. */
const MAX_COMMENT = 500;

const megabytes = (bytes: number): string => `${Math.floor(bytes / 100_000) / 10} MB`;

function revokePreviews(files: readonly { readonly previewUrl?: string | undefined }[]): void {
  for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

/** The chat's state and actions for one bot, without any UI (ADR-0011). */
export function createChatStore(
  initialConfig: ChatConfig,
  options: ChatStoreOptions = {},
): ChatStore {
  // Both change when the language switches in place; everything reads the current ones.
  let config = initialConfig;
  let t = translator(config.widget.texts);
  /** The session waiting for the visitor to pass the human check, if any (ADR-0019). */
  let humanCheck: { resolve(token: string): void; reject(error: Error): void } | undefined;
  /** Mounted `HumanCheck` components; without one, the check can never be passed. */
  let checkers = 0;
  const requestHumanCheck = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      humanCheck?.reject(new Error('replaced'));
      humanCheck = { resolve, reject };
      if (checkers === 0) {
        console.warn('[askdare] Render <HumanCheck />: this bot needs a human check to connect.');
      }
      set({ humanCheck: true });
    });
  const answerHumanCheck = (token: string | null): void => {
    const waiting = humanCheck;
    humanCheck = undefined;
    if (state.humanCheck) set({ humanCheck: false });
    if (token) waiting?.resolve(token);
    else waiting?.reject(new Error('The human check failed.'));
  };
  const client =
    options.client ??
    new ChatClient({
      basePath: config.basePath,
      botId: config.botId,
      locale: config.widget.locale,
      storage: browserStorage(),
      translate: (key, params) =>
        config.widget.texts[key] === undefined ? undefined : t(key as TextKey, params),
      ...(config.humanCheck ? { humanToken: requestHumanCheck } : {}),
    });
  const recorder = options.recorder ?? { canRecord, startRecording };
  const voice = config.voice;
  const allowed = config.attachments;

  const initial: ChatState = {
    phase: 'starting',
    busy: false,
    messages: [],
    earlier: 'none',
    draft: '',
    error: undefined,
    activity: null,
    files: [],
    dictation: 'idle',
    elapsed: 0,
    canDictate: false,
    page: options.page ?? {},
    ratings: {},
    commenting: undefined,
    humanCheck: false,
  };
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (change: Partial<ChatState>): void => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const events = eventListeners<ChatEvent>();
  const bot = config.botId;
  /** `ready` fires once per chat, not again when a sign-in reloads the conversation. */
  let announced = false;
  const announce = (): void => {
    if (announced) return;
    announced = true;
    events.emit({ type: 'ready', bot });
  };
  const { focus, onFocus } = focusRequests();
  const apply = (event: ProtocolEvent): void =>
    set({ messages: applyEvent(state.messages, event) });

  let localId = 0;
  const nextLocalId = (): string => `local_${++localId}`;

  /** The current run between start() and stop(); async work of an earlier run stops there. */
  let run: object | undefined;
  /** Signed in (or anonymous) for good: requests may go out. */
  let identityReady = false;
  /** The visible conversation is the one this browser should show. */
  let loaded = false;
  let identities = Promise.resolve();
  let history: AbortController | undefined;
  /** Loads the page of older messages, while `state.earlier` is `loading`. */
  let older: AbortController | undefined;
  /** The server's cursor to the page before the oldest shown; opaque, never in the state. */
  let before: string | undefined;
  /** Another conversation shows: its older pages are not this one's. */
  const forgetEarlier = (): void => {
    older?.abort();
    older = undefined;
    before = undefined;
  };
  /** The turn being answered, aborted when the chat stops. */
  let turn: AbortController | undefined;
  /** Reports how the turn being answered ended; stop() calls it before anyone stops listening. */
  let endTurn: ((outcome: 'completed' | 'stopped' | 'failed') => void) | undefined;
  /**
   * Per rating key: what the server confirmed, and the latest request. Ratings of one answer go out
   * one at a time, so the server ends with the latest that succeeded and a failure rolls back to it.
   */
  const rated = new Map<
    string,
    { confirmed: Rating | undefined; latest: number; queue: Promise<unknown> }
  >();
  /** In-flight uploads by pending file key, cancelled when the file is removed. */
  const uploads = new Map<string, AbortController>();

  let recording: Recording | undefined;
  /** Set while the browser asks for the microphone, so a double click starts one recording. */
  let starting = false;
  /** Ends the dictation at maxSeconds; a timer, because animation frames stop in hidden frames. */
  let limit: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setInterval> | undefined;

  /** Stops a dictation and throws the audio away. */
  const discardRecording = (): void => {
    clearTimeout(limit);
    clearInterval(clock);
    recording?.cancel();
    recording = undefined;
    if (state.dictation !== 'idle') set({ dictation: 'idle' });
  };

  /** Restores the stored conversation (about 2 s upstream, so the chat shows a loading state). */
  const loadHistory = (): void => {
    history?.abort();
    if (!client.hasConversation()) {
      history = undefined;
      loaded = true;
      set({ phase: 'ready' });
      announce();
      return;
    }
    const controller = new AbortController();
    history = controller;
    set({ phase: 'loading' });
    client
      .loadHistory(controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        loaded = true;
        before = page.before;
        set({ messages: page.messages.map(fromHistory), earlier: before ? 'more' : 'none' });
      })
      .catch((error: unknown) => {
        // A refused session says why (explained in development); anything else is generic.
        if (!controller.signal.aborted) {
          set({ error: error instanceof SessionRefused ? error.message : t('error.history') });
        }
      })
      .finally(() => {
        if (history !== controller) return;
        history = undefined;
        set({ phase: 'ready' });
        // Not when loading failed: a refused session can't take messages.
        if (loaded) announce();
      });
  };

  /**
   * After an answer was lost on the way: puts the latest turn in as the history has it, once its
   * answer is there. Only what follows the visitor's last message changes, so older pages and the
   * oldest message shown stay. The history's turn must be this one, not the one before: it starts
   * with the visitor's message, and its answer isn't the one shown before it.
   */
  const recover = async (signal: AbortSignal): Promise<boolean> => {
    try {
      const page = (await client.loadHistory(signal)).messages;
      const { messages } = state;
      const after = (list: readonly { readonly role: string }[]): number =>
        list.findLastIndex((message) => message.role === 'user') + 1;
      const mine = after(messages);
      const theirs = after(page);
      const answer = page.at(-1);
      if (
        signal.aborted ||
        page[theirs - 1]?.text !== messages[mine - 1]?.text ||
        answer?.role !== 'assistant' ||
        answer.text === messages[mine - 2]?.text
      ) {
        return false;
      }
      set({
        messages: [
          ...messages.slice(0, mine),
          ...page.slice(theirs, -1).map(fromHistory),
          // Under the id it streamed with: the same element, announced once done, found by `end`.
          { ...fromHistory(answer), id: messages[mine]?.id ?? answer.id },
        ],
      });
      return true;
    } catch {
      return false;
    }
  };

  const onVisibility = (): void => {
    // Never keep the microphone on in a chat the visitor can't see.
    if (document.visibilityState === 'hidden') discardRecording();
  };

  const cancelUploads = (keys: Iterable<string>): void => {
    for (const key of [...keys]) {
      uploads.get(key)?.abort();
      uploads.delete(key);
    }
  };

  const attach = async (file: File): Promise<void> => {
    if (!allowed) return;
    const key = nextLocalId();
    const update = (change: Partial<PendingFile>): void =>
      set({ files: state.files.map((item) => (item.key === key ? { ...item, ...change } : item)) });
    const controller = new AbortController();
    uploads.set(key, controller);
    set({ files: [...state.files, { key, name: file.name, status: 'uploading' }] });
    const fail = (error: string): void => {
      uploads.delete(key);
      if (!controller.signal.aborted) update({ status: 'error', error });
    };
    let prepared: Awaited<ReturnType<typeof prepareFile>>;
    try {
      prepared = await prepareFile(file, allowed);
    } catch {
      fail(t('attachment.unsupported'));
      return;
    }
    if (prepared.blob.size > allowed.maxBytes) {
      fail(t('attachment.tooLarge', { size: megabytes(allowed.maxBytes) }));
      return;
    }
    if (controller.signal.aborted) return;
    const previewUrl = prepared.kind === 'image' ? URL.createObjectURL(prepared.blob) : undefined;
    update({ name: prepared.name, kind: prepared.kind, previewUrl });
    const result = await client.upload(prepared.blob, prepared.name, controller.signal);
    uploads.delete(key);
    if (controller.signal.aborted) {
      // Removed while uploading: the preview may not have reached the rendered list yet.
      revokePreviews([{ previewUrl }]);
      return;
    }
    update(
      result.ok
        ? { status: 'ready', handle: result.file.id, name: result.file.name }
        : { status: 'error', error: result.message },
    );
  };

  const actions: ChatActions = {
    async send(picked) {
      const text = (picked ?? state.draft).trim();
      if (
        picked === undefined
          ? !canSend(state)
          : state.phase !== 'ready' || state.busy || text === ''
      ) {
        return;
      }
      // A picked text goes on its own: the files and the draft wait for the visitor's own message.
      const ready =
        picked === undefined ? state.files.filter((file) => file.status === 'ready') : [];
      const files: SentFile[] = ready.flatMap(({ name, kind, previewUrl }) =>
        kind ? [{ name, kind, previewUrl }] : [],
      );
      const handles = ready.flatMap((file) => (file.handle ? [file.handle] : []));
      const latest = state.messages.at(-1);
      const source =
        picked === undefined
          ? 'typed'
          : latest?.role === 'assistant' && latest.replies?.includes(text)
            ? 'reply'
            : 'starter';
      if (picked === undefined)
        revokePreviews(state.files.filter((file) => file.status !== 'ready'));
      set({
        ...(picked === undefined ? { files: [], draft: '' } : {}),
        error: undefined,
        busy: true,
        messages: [
          ...state.messages,
          {
            id: nextLocalId(),
            role: 'user',
            text,
            citations: [],
            attachments: files.length,
            files,
            status: 'done',
          },
        ],
      });
      events.emit({
        type: 'message.sent',
        bot,
        length: [...text].length,
        attachments: files.length,
        source,
      });
      const context = config.pageContext ? state.page.context : undefined;
      const controller = new AbortController();
      turn = controller;
      const begun = Date.now();
      let failed = false;
      let answer: string | undefined;
      const end = (outcome: 'completed' | 'stopped' | 'failed'): void => {
        if (endTurn !== end) return;
        endTurn = undefined;
        const received = state.messages.find((message) => message.id === answer);
        events.emit({
          type: 'message.received',
          bot,
          outcome,
          durationMs: Date.now() - begun,
          citations: received?.citations.length ?? 0,
        });
      };
      endTurn = end;
      const fail = (problem: { readonly code: ErrorCode; readonly message: string }): void => {
        failed = true;
        events.emit({ type: 'error', bot, code: problem.code });
        set({ error: problem.message, messages: failStreaming(state.messages) });
      };
      const lost = await client.send(
        { text, attachments: handles, context },
        (event) => {
          const next = activityFor(event, t);
          if (next !== undefined) set({ activity: next });
          if (event.type === 'message.start') answer = event.messageId;
          if (event.type === 'error') fail(event);
          else apply(event);
        },
        controller.signal,
        // Quietly, in the status, until the answer goes on.
        (reconnecting) => set({ activity: reconnecting ? t('status.reconnecting') : null }),
      );
      // The answer couldn't be resumed: the history has it once it is done.
      if (lost && !(await recover(controller.signal)) && !controller.signal.aborted) fail(lost);
      if (turn === controller) turn = undefined;
      end(failed ? 'failed' : controller.signal.aborted ? 'stopped' : 'completed');
      if (controller.signal.aborted) {
        // The chat stopped mid-answer: nothing streams into it any more.
        set({ activity: null, busy: false, messages: failStreaming(state.messages) });
        return;
      }
      set({ activity: null, busy: false });
      focus('input');
    },

    setDraft(text) {
      set({ draft: text });
    },

    addFiles(files) {
      if (!allowed || files.length === 0) return;
      const room = allowed.maxPerMessage - state.files.length;
      if (files.length > room) {
        set({ error: t('attachment.tooMany', { count: allowed.maxPerMessage }) });
      }
      for (const file of files.slice(0, Math.max(0, room))) void attach(file);
    },

    removeFile(key) {
      cancelUploads([key]);
      revokePreviews(state.files.filter((item) => item.key === key));
      set({ files: state.files.filter((item) => item.key !== key) });
    },

    async startDictation() {
      // Not while the last dictation is still being transcribed: its result would end this one.
      if (!voice || recording || starting || state.dictation !== 'idle') return;
      set({ error: undefined });
      starting = true;
      let started: Recording;
      try {
        started = await recorder.startRecording(voice.maxSeconds);
      } catch (error) {
        set({
          error: t(MICROPHONE_MESSAGES[error instanceof MicrophoneError ? error.reason : 'failed']),
        });
        return;
      } finally {
        starting = false;
      }
      // Stopped while the browser asked for the microphone: never leave it on.
      if (!run) {
        started.cancel();
        return;
      }
      recording = started;
      set({ elapsed: 0, dictation: 'recording' });
      focus('dictation');
      limit = setTimeout(() => void actions.finishDictation(), voice.maxSeconds * 1000);
      const begun = Date.now();
      clock = setInterval(() => {
        const elapsed = Math.min(voice.maxSeconds, Math.floor((Date.now() - begun) / 1000));
        if (elapsed !== state.elapsed) set({ elapsed });
      }, 250);
    },

    async finishDictation() {
      const current = recording;
      if (!current) return;
      recording = undefined;
      clearTimeout(limit);
      clearInterval(clock);
      set({ dictation: 'transcribing' });
      const audio = await current.stop();
      if (audio.size < 1_000) {
        set({ dictation: 'idle', error: t('dictation.empty') });
        return;
      }
      const languages = [...navigator.languages.slice(0, 2), config.widget.locale];
      const result = await client.transcribe(audio, languages);
      set({ dictation: 'idle' });
      if (!result.ok) {
        set({ error: result.message });
      } else if (result.text) {
        // Into the field, not sent: the visitor checks the transcript first.
        const draft = state.draft;
        set({ draft: draft.trim() ? `${draft.trimEnd()} ${result.text}` : result.text });
      }
      focus('input');
    },

    cancelDictation() {
      discardRecording();
      focus('input');
    },

    async newConversation() {
      set({ busy: true });
      await client.deleteConversation().catch(() => undefined);
      revokePreviews(state.messages.flatMap((message) => message.files ?? []));
      cancelUploads(uploads.keys());
      revokePreviews(state.files);
      forgetEarlier();
      set({
        files: [],
        messages: [],
        earlier: 'none',
        error: undefined,
        busy: false,
        commenting: undefined,
      });
      events.emit({ type: 'conversation.reset', bot });
      focus('input');
    },

    async rate(messageId, rating, comment) {
      const feedback = state.messages.find((message) => message.id === messageId)?.feedback;
      if (!feedback) return;
      const { key } = feedback;
      const before = state.ratings[key];
      const text = comment?.trim().slice(0, MAX_COMMENT);
      const commented = rating === 'down' && Boolean(text);
      const ratings = (value: Rating | null | undefined): ChatState['ratings'] => {
        const { [key]: _previous, ...others } = state.ratings;
        return value ? { ...others, [key]: value } : others;
      };
      const entry = rated.get(key) ?? { confirmed: before, latest: 0, queue: Promise.resolve() };
      rated.set(key, entry);
      const request = ++entry.latest;
      // Shown at once; taken back if the server refuses it.
      set({
        ratings: ratings(rating),
        error: undefined,
        // A fresh 👎 asks what went wrong, and the question stays open until its comment is sent;
        // any other rating ends it.
        commenting: commented || (rating === 'down' && before !== 'down') ? messageId : undefined,
      });
      const sent = entry.queue.then(() =>
        client.rate(feedback.handle, rating, rating === null ? undefined : text),
      );
      entry.queue = sent;
      const problem = await sent;
      if (!problem) {
        entry.confirmed = rating ?? undefined;
        client.rememberRating(key, rating);
        events.emit({ type: 'feedback', bot, rating, commented });
      }
      // A later rating of the same answer decides what the chat shows.
      if (entry.latest !== request) return;
      if (problem) {
        // A comment that didn't go out stays in its form, so the visitor can send it again.
        set({
          ratings: ratings(entry.confirmed),
          error: problem,
          ...(commented ? {} : { commenting: undefined }),
        });
      } else if (commented && state.commenting === messageId) {
        set({ commenting: undefined });
      }
    },

    async loadEarlier() {
      const cursor = before;
      if (!cursor || state.earlier !== 'more') return;
      const controller = new AbortController();
      older = controller;
      // Only the chat's own earlier failure goes: an error the visitor hasn't acted on stays.
      if (state.error === t('error.earlier')) set({ error: undefined });
      set({ earlier: 'loading' });
      let next: Partial<ChatState>;
      let after: string | undefined = cursor;
      try {
        const page = await client.loadHistory(controller.signal, cursor);
        after = page.before;
        // Pages are whole turns, so the older one goes above without merging.
        next = { messages: [...page.messages.map(fromHistory), ...state.messages] };
      } catch (error) {
        // A refused cursor (expired, say) can't work again, and a gone conversation has no pages.
        const cause = error instanceof Error ? error.cause : undefined;
        if (cause === 400 || cause === 404) after = undefined;
        next = {
          error:
            cause === 404
              ? t('error.conversationGone')
              : error instanceof SessionRefused
                ? error.message
                : t('error.earlier'),
        };
      }
      // Stopped, or another conversation shows now: nothing of this one goes in.
      if (older !== controller) return;
      older = undefined;
      before = after;
      set({ ...next, earlier: after ? 'more' : 'none' });
    },

    async handoff() {
      const answer = state.messages.findLast((message) => message.role === 'assistant');
      // Not while one runs, or while its form waits.
      if (state.phase !== 'ready' || !answer || answer.handoff === 'requested') return;
      const messageId = answer.id;
      apply({ type: 'handoff', messageId, state: 'requested' });
      set({ error: undefined });
      const { body, error } = await client.post('/handoff');
      // Checked as the stream's own events would be.
      const reply = body as { state?: unknown; form?: object } | undefined;
      const final = error
        ? undefined
        : parseEvent({ type: 'handoff', messageId, state: reply?.state });
      const form =
        reply?.form &&
        parseEvent({ ...reply.form, type: 'form', messageId, callId: nextLocalId() });
      if (final && (form || !reply?.form)) {
        apply(final);
        if (form) apply(form);
      } else {
        // Back to what the answer showed before (undefined: nothing).
        apply({ type: 'handoff', messageId, state: answer.handoff as HandoffState });
        set({ error: error ?? t('error.upstream_error') });
      }
    },

    async submitForm(handle, values) {
      const message = state.messages.find((item) =>
        item.forms?.some((form) => form.handle === handle && form.state === 'open'),
      );
      if (!message) return;
      const update = (change: Partial<MessageForm>): void =>
        set({ messages: changeForm(state.messages, handle, change) });
      update({ state: 'submitting', errors: undefined, error: undefined });
      const { status, body, error } = await client.post('/forms', { form: handle, values });
      const reply = body as
        | { state?: unknown; handoff?: unknown; error?: { fields?: FormFieldErrors } }
        | undefined;
      if (!error && reply?.state === 'sent') {
        update({ state: 'sent' });
        // A handoff's form: the handoff's final state.
        const handoff = parseEvent({
          type: 'handoff',
          messageId: message.id,
          state: reply.handoff,
        });
        if (handoff) apply(handoff);
        return;
      }
      // Error keys by field name; the chat looks them up with `t` and shows them as plain text.
      const errors = reply?.error?.fields;
      // Sent before (409), or a handle the server no longer takes (404): it can't go out again.
      update(
        status === 409
          ? { state: 'sent' }
          : status === 404
            ? { state: 'expired' }
            : typeof errors === 'object'
              ? { state: 'open', errors }
              : { state: 'open', error: error ?? t('error.upstream_error') },
      );
    },

    dismissComment() {
      if (state.commenting !== undefined) set({ commenting: undefined });
    },

    focus() {
      focus('input', true);
    },
  };

  /** Counts language switches, so only the latest one applies. */
  let switches = 0;
  let language: string | undefined;

  return {
    get config() {
      return config;
    },
    actions,
    get t() {
      return t;
    },
    get language() {
      return language;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,

    start(startOptions = {}) {
      if (run) return;
      const current = {};
      run = current;
      set({
        ratings: client.ratings(),
        canDictate: voice !== undefined && recorder.canRecord(),
        // The stored conversation shows as loading from the first paint.
        ...(state.phase === 'starting' && client.hasConversation()
          ? { phase: 'loading' as const }
          : {}),
      });
      document.addEventListener('visibilitychange', onVisibility);
      // The first request waits for the page's identity, so a signed-in visitor gets theirs.
      void (startOptions.handshake ?? Promise.resolve())
        // A handshake that fails is like none: the chat starts without the page's identity.
        .then(
          () => identities,
          () => identities,
        )
        .finally(() => {
          if (run !== current) return;
          identityReady = true;
          if (!loaded) loadHistory();
          else {
            if (state.phase !== 'ready') set({ phase: 'ready' });
            announce();
          }
        });
    },

    stop() {
      if (!run) return;
      run = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      history?.abort();
      history = undefined;
      // The cursor stays: the same page can load after start().
      older?.abort();
      older = undefined;
      if (state.earlier === 'loading') set({ earlier: 'more' });
      endTurn?.('stopped');
      turn?.abort();
      turn = undefined;
      discardRecording();
      // A session waiting for the human check gives up; the next request asks again.
      answerHumanCheck(null);
      // Uploads still running stop with their files; files already uploaded stay for the next run.
      if (uploads.size > 0) {
        cancelUploads(uploads.keys());
        set({ files: state.files.filter((file) => file.status !== 'uploading') });
      }
    },

    identify(token) {
      identities = identities.then(async () => {
        // A turn sent while the session changes already goes out as the next person.
        const previous = turn;
        // Signed in, out or as someone else: show that person's conversation, if any.
        if (!(await client.identify(token))) return;
        // An answer still streaming belongs to the previous person's conversation, where the
        // server finishes it: it stops here, as when the chat stops, and is never resumed.
        if (previous && turn === previous) {
          endTurn?.('stopped');
          previous.abort();
          turn = undefined;
        }
        loaded = false;
        forgetEarlier();
        set({ messages: [], earlier: 'none', error: undefined, commenting: undefined });
        if (identityReady && run) loadHistory();
      });
    },

    configure(page) {
      set({ page });
    },

    async setLocale(locale, next) {
      const id = ++switches;
      const fetched = next
        ? { widget: next.widget, language: undefined, forms: next.forms }
        : await client.fetchWidget(locale);
      if (id !== switches || fetched === undefined) return false;
      const { widget, forms } = fetched;
      language = fetched.language;
      // Only what depends on the language; the look and the rest stay as they are.
      const { title, greeting, placeholder, launcherLabel, texts } = widget;
      config = {
        ...config,
        widget: {
          ...config.widget,
          locale: widget.locale,
          title,
          greeting,
          placeholder,
          launcherLabel,
          texts,
        },
        // Open forms follow the language with the rest of the chat.
        ...(forms ? { forms } : {}),
      };
      t = translator(texts);
      client.setLocale(widget.locale);
      // A new snapshot, so every part of the chat renders the new texts.
      set({});
      return true;
    },

    hide() {
      discardRecording();
    },

    answerHumanCheck,

    attachHumanCheck() {
      checkers += 1;
      return () => {
        checkers -= 1;
      };
    },

    level: () => recording?.level(),

    onFocus,

    onEvent: (listener: ChatEventListener) => events.on('*', listener),
  };
}
