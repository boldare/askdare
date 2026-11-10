import type { TextKey } from '../i18n/texts';
import { ChatClient, SessionRefused } from './chat-client';
import type { ChatConfig } from './config';
import type { PageOptions } from './page-options';
import { prepareFile } from './prepare-file';
import { canRecord, MicrophoneError, type Recording, startRecording } from './recorder';
import {
  activityFor,
  applyEvent,
  failStreaming,
  fromHistory,
  type Translate,
  translator,
} from './reducer';
import { type ChatState, canSend, type PendingFile, type SentFile } from './state';
import { browserStorage } from './storage';

/** What visitors can do in the chat; the same for every UI on top of the store. */
export interface ChatActions {
  /** Sends the draft with the files that are ready, or `text` (a starter) on its own. */
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
  /** Moves keyboard focus to the message field. */
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
  /** Stops anything live, such as a dictation. `start()` may run again. */
  stop(): void;
  /** Signs the visitor in with a token from the site's backend, or out with null (ADR-0009). */
  identify(token: string | null): void;
  configure(page: PageOptions): void;
  /** The chat was hidden: the microphone goes off. */
  hide(): void;
  /** The microphone's loudness from 0 to 1 while recording. */
  level(): number | undefined;
  /**
   * Registers what takes focus for `target`. The listener focuses its element and returns whether
   * it could; a request nobody could take yet goes to the next listener. Returns an unsubscribe.
   */
  onFocus(target: FocusTarget, listener: FocusListener): () => void;
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

/** Focuses its element and says whether it could; false when the element is gone. */
export type FocusListener = () => boolean;

/**
 * Where the chat wants focus next. A request stays pending until a listener for its target really
 * takes it: the message field comes back only after a dictation ends, and a listener whose element
 * has just unmounted must not swallow the request. Only the latest request is kept.
 */
export function focusRequests(): {
  focus(target: FocusTarget): void;
  onFocus(target: FocusTarget, listener: FocusListener): () => void;
} {
  const listeners: Record<FocusTarget, Set<FocusListener>> = {
    input: new Set(),
    dictation: new Set(),
  };
  let pending: FocusTarget | undefined;
  const deliver = (target: FocusTarget): boolean => {
    let taken = false;
    for (const listener of listeners[target]) taken = listener() || taken;
    return taken;
  };
  return {
    focus(target) {
      pending = deliver(target) ? undefined : target;
    },
    onFocus(target, listener) {
      listeners[target].add(listener);
      if (pending === target && listener()) pending = undefined;
      return () => listeners[target].delete(listener);
    },
  };
}

const MICROPHONE_MESSAGES: Readonly<Record<MicrophoneError['reason'], TextKey>> = {
  blocked: 'microphone.blocked',
  missing: 'microphone.missing',
  failed: 'microphone.failed',
};

const megabytes = (bytes: number): string => `${Math.floor(bytes / 100_000) / 10} MB`;

function revokePreviews(files: readonly { readonly previewUrl?: string | undefined }[]): void {
  for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

/** The chat's state and actions for one bot, without any UI (ADR-0011). */
export function createChatStore(config: ChatConfig, options: ChatStoreOptions = {}): ChatStore {
  const t = translator(config.widget.texts);
  const client =
    options.client ??
    new ChatClient({
      basePath: config.basePath,
      botId: config.botId,
      locale: config.widget.locale,
      storage: browserStorage(),
      translate: (key, params) =>
        config.widget.texts[key] === undefined ? undefined : t(key as TextKey, params),
    });
  const recorder = options.recorder ?? { canRecord, startRecording };
  const voice = config.voice;
  const allowed = config.attachments;

  const initial: ChatState = {
    phase: 'starting',
    busy: false,
    messages: [],
    draft: '',
    error: undefined,
    activity: null,
    files: [],
    dictation: 'idle',
    elapsed: 0,
    canDictate: false,
    page: options.page ?? {},
  };
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (change: Partial<ChatState>): void => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const { focus, onFocus } = focusRequests();

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
      return;
    }
    const controller = new AbortController();
    history = controller;
    set({ phase: 'loading' });
    client
      .loadHistory(controller.signal)
      .then((messages) => {
        if (controller.signal.aborted) return;
        loaded = true;
        set({ messages: messages.map(fromHistory) });
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
      });
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
      const uploading = state.files.some((file) => file.status === 'uploading');
      if (
        picked === undefined
          ? !canSend(state)
          : state.phase !== 'ready' || state.busy || uploading || text === ''
      ) {
        return;
      }
      const ready = state.files.filter((file) => file.status === 'ready');
      const files: SentFile[] = ready.flatMap(({ name, kind, previewUrl }) =>
        kind ? [{ name, kind, previewUrl }] : [],
      );
      const handles = ready.flatMap((file) => (file.handle ? [file.handle] : []));
      revokePreviews(state.files.filter((file) => file.status !== 'ready'));
      set({
        files: [],
        ...(picked === undefined ? { draft: '' } : {}),
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
      const context = config.pageContext ? state.page.context : undefined;
      await client.send({ text, attachments: handles, context }, (event) => {
        const next = activityFor(event, t);
        if (next !== undefined) set({ activity: next });
        if (event.type === 'error') {
          set({ error: event.message, messages: failStreaming(state.messages) });
          return;
        }
        set({ messages: applyEvent(state.messages, event) });
      });
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
      if (!voice || recording || starting) return;
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
      set({ files: [], messages: [], error: undefined, busy: false });
      focus('input');
    },

    focus() {
      focus('input');
    },
  };

  return {
    config,
    actions,
    t,
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
        canDictate: voice !== undefined && recorder.canRecord(),
        // The stored conversation shows as loading from the first paint.
        ...(state.phase === 'starting' && client.hasConversation()
          ? { phase: 'loading' as const }
          : {}),
      });
      document.addEventListener('visibilitychange', onVisibility);
      // The first request waits for the page's identity, so a signed-in visitor gets theirs.
      void (startOptions.handshake ?? Promise.resolve())
        .then(() => identities)
        .finally(() => {
          if (run !== current) return;
          identityReady = true;
          if (!loaded) loadHistory();
          else if (state.phase !== 'ready') set({ phase: 'ready' });
        });
    },

    stop() {
      if (!run) return;
      run = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      history?.abort();
      history = undefined;
      discardRecording();
    },

    identify(token) {
      identities = identities.then(async () => {
        // Signed in, out or as someone else: show that person's conversation, if any.
        if (!(await client.identify(token))) return;
        loaded = false;
        set({ messages: [], error: undefined });
        if (identityReady && run) loadHistory();
      });
    },

    configure(page) {
      set({ page });
    },

    hide() {
      discardRecording();
    },

    level: () => recording?.level(),

    onFocus,
  };
}
