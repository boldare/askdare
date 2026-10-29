import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { formatText, pluralText } from '../i18n/format';
import type { TextKey } from '../i18n/texts';
import type { ProtocolEvent } from '../protocol/events';
import type { HistoryMessage } from '../protocol/history';
import type { EmbedConfig } from '../server/embed-page';
import type { ChatClient } from './chat-client';
import type { HostBridge, PageOptions } from './host-bridge';
import { AttachIcon, CloseIcon, MicIcon, RestartIcon, SendIcon } from './icons';
import { Markdown } from './markdown';
import { acceptTypes, prepareFile } from './prepare-file';
import { canRecord, MicrophoneError, type Recording, startRecording } from './recorder';
import { Avatar, Welcome } from './welcome';

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

export interface Message {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly Citation[];
  /** Number of files, from history. */
  readonly attachments: number;
  /** Files sent in this session. */
  readonly files?: readonly SentFile[];
  readonly status: 'streaming' | 'done' | 'error';
}

export interface PendingFile {
  readonly key: string;
  readonly name: string;
  readonly kind?: 'image' | 'pdf' | undefined;
  readonly previewUrl?: string | undefined;
  readonly status: 'uploading' | 'ready' | 'error';
  readonly handle?: string | undefined;
  readonly error?: string | undefined;
}

const megabytes = (bytes: number): string => `${Math.floor(bytes / 100_000) / 10} MB`;

/** False for an assistant message that ended (or failed) before any text, files or sources. */
const hasContent = (message: Message): boolean =>
  message.role === 'user' ||
  message.status === 'streaming' ||
  message.text !== '' ||
  message.citations.length > 0;

/** Grows the message field with its content, up to the height set in CSS. */
function fitToContent(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

type Translate = (key: TextKey, params?: Readonly<Record<string, string | number>>) => string;

const MICROPHONE_MESSAGES: Readonly<Record<MicrophoneError['reason'], TextKey>> = {
  blocked: 'microphone.blocked',
  missing: 'microphone.missing',
  failed: 'microphone.failed',
};

function revokePreviews(files: readonly { readonly previewUrl?: string | undefined }[]): void {
  for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

function FileList({
  files,
  part,
  t,
  onRemove,
}: {
  readonly files: readonly (SentFile | PendingFile)[];
  readonly part: 'attachments' | 'message-attachments';
  readonly t: Translate;
  readonly onRemove?: (file: PendingFile) => void;
}) {
  return (
    <ul data-cd-part={part} aria-label={t('attachment.list')}>
      {files.map((file, index) => {
        const pending = 'status' in file ? file : undefined;
        return (
          <li
            key={pending?.key ?? index}
            data-cd-part="attachment"
            data-kind={file.kind}
            data-status={pending?.status}
          >
            {file.previewUrl ? (
              <img data-cd-part="attachment-preview" src={file.previewUrl} alt="" />
            ) : (
              <span data-cd-part="attachment-badge" aria-hidden="true">
                {file.kind === 'image' ? 'IMG' : file.kind === 'pdf' ? 'PDF' : 'FILE'}
              </span>
            )}
            <span data-cd-part="attachment-name">{file.name}</span>
            {pending?.status === 'uploading' && (
              <span data-cd-part="attachment-status">{t('attachment.uploading')}</span>
            )}
            {pending?.status === 'error' && (
              <span data-cd-part="attachment-status" role="alert">
                {pending.error}
              </span>
            )}
            {pending && onRemove && (
              <button
                type="button"
                data-cd-part="attachment-remove"
                aria-label={t('attachment.remove', { name: file.name })}
                onClick={() => onRemove(pending)}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A frozen state for the gallery: design review and visual tests, never a live chat. */
export interface Fixture {
  readonly messages: readonly Message[];
  readonly pending?: readonly PendingFile[];
  readonly draft?: string;
  readonly busy?: boolean;
  readonly activity?: string;
  readonly error?: string;
  readonly dictation?: 'recording' | 'transcribing';
  readonly elapsed?: number;
}

export interface AppProps {
  readonly config: EmbedConfig;
  readonly client: ChatClient;
  readonly bridge: HostBridge;
  /** Inside an element of the host page (data-mode="inline"): no close button. */
  readonly inline?: boolean;
  readonly fixture?: Fixture | undefined;
}

let localId = 0;
const nextLocalId = (): string => `local_${++localId}`;

const fromHistory = (message: HistoryMessage): Message => ({ ...message, status: 'done' });

function applyEvent(messages: readonly Message[], event: ProtocolEvent): readonly Message[] {
  const update = (id: string, change: (message: Message) => Message): readonly Message[] =>
    messages.map((message) => (message.id === id ? change(message) : message));
  switch (event.type) {
    case 'message.start':
      return [
        ...messages,
        {
          id: event.messageId,
          role: 'assistant',
          text: '',
          citations: [],
          attachments: 0,
          status: 'streaming',
        },
      ];
    case 'text.delta':
      return update(event.messageId, (message) => ({
        ...message,
        text: message.text + event.delta,
      }));
    case 'citation':
      return update(event.messageId, (message) => ({
        ...message,
        citations: [
          ...message.citations,
          { index: event.index, title: event.title, url: event.url },
        ],
      }));
    case 'message.end':
      return update(event.messageId, (message) => ({ ...message, status: 'done' }));
    default:
      return messages;
  }
}

/** What the assistant is doing right now, shown while no text streams. */
function activityFor(event: ProtocolEvent, t: Translate): string | null | undefined {
  if (event.type === 'reasoning') return event.state === 'started' ? t('status.thinking') : null;
  if (event.type === 'tool.status')
    return event.state === 'running'
      ? event.name === 'file_search'
        ? t('status.searching')
        : t('status.tool', { name: event.name })
      : null;
  if (event.type === 'text.delta' || event.type === 'message.end') return null;
  return undefined; // unchanged
}

export function App({ config, client, bridge, fixture, inline = false }: AppProps) {
  const [page, setPage] = useState<PageOptions>({});
  useEffect(() => bridge.onConfigure(setPage), [bridge]);
  // The host page may set a greeting and suggestions per page (chatdock('configure')).
  const widget = {
    ...config.widget,
    ...(page.greeting ? { greeting: page.greeting } : {}),
    ...(page.starters ? { starters: page.starters } : {}),
  };
  // Stable, so effects can use it: the texts never change while the chat is open.
  const t = useCallback<Translate>(
    (key, params) => formatText(widget.texts[key] ?? key, params),
    [widget.texts],
  );
  const [messages, setMessages] = useState<readonly Message[]>(fixture?.messages ?? []);
  const [draft, setDraft] = useState(fixture?.draft ?? '');
  const [busy, setBusy] = useState(fixture?.busy ?? false);
  const [loading, setLoading] = useState(() => !fixture && client.hasConversation());
  const [error, setError] = useState<string | undefined>(fixture?.error);
  const [activity, setActivity] = useState<string | null>(fixture?.activity ?? null);
  const [pending, setPending] = useState<readonly PendingFile[]>(fixture?.pending ?? []);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = config.voice;
  const [voiceAvailable] = useState(() => voice !== undefined && (!!fixture || canRecord()));
  const [dictation, setDictation] = useState<'idle' | 'recording' | 'transcribing'>(
    fixture?.dictation ?? 'idle',
  );
  const [elapsed, setElapsed] = useState(fixture?.elapsed ?? 0);
  const recordingRef = useRef<Recording | undefined>(undefined);
  /** Set while the browser asks for the microphone, so a double click starts one recording. */
  const startingRef = useRef(false);
  /** Ends the dictation at maxSeconds; a timer, because animation frames stop in hidden frames. */
  const limitRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const levelRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  /** In-flight uploads by pending file key, cancelled when the file is removed. */
  const uploads = useRef(new Map<string, AbortController>());
  const allowed = config.attachments;

  // Fit the field to its text whenever it changes, typed or not (a transcript, a restored draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field shows draft, which sets its height
  useLayoutEffect(() => {
    if (inputRef.current && dictation === 'idle') fitToContent(inputRef.current);
  }, [draft, dictation]);

  /** Stops a dictation and throws the audio away. Stable, so effects can depend on it. */
  const discardRecording = useCallback((): void => {
    clearTimeout(limitRef.current);
    recordingRef.current?.cancel();
    recordingRef.current = undefined;
    setDictation('idle');
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // While dictating, Escape cancels the recording instead of closing the chat.
      if (recordingRef.current) {
        discardRecording();
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      bridge.close();
    };
    // Never keep the microphone on in a chat the visitor can't see.
    const onHidden = (): void => discardRecording();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') discardRecording();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = bridge.onHidden(onHidden);
    // A floating chat was just opened by the visitor; an inline one only loaded with the page.
    if (!inline) inputRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
      discardRecording();
    };
  }, [bridge, discardRecording, inline]);

  // Restore the stored conversation once (about 2 s upstream, so show a loading state).
  useEffect(() => {
    if (fixture || !client.hasConversation()) return;
    const controller = new AbortController();
    client
      .loadHistory(controller.signal)
      .then((history) => setMessages(history.map(fromHistory)))
      .catch(() => {
        if (!controller.signal.aborted) setError(t('error.history'));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [client, fixture, t]);

  // Follow the conversation, including each streamed delta of the latest message.
  const latestText = messages.at(-1)?.text;
  useEffect(() => {
    const log = logRef.current;
    if (log && latestText !== undefined) log.scrollTop = log.scrollHeight;
  }, [latestText]);

  const uploading = pending.some((file) => file.status === 'uploading');
  const ready = pending.filter((file) => file.status === 'ready');
  const canSend = !busy && !loading && !uploading && (draft.trim() !== '' || ready.length > 0);

  const attach = async (file: File): Promise<void> => {
    if (!allowed) return;
    const key = nextLocalId();
    const update = (change: Partial<PendingFile>): void =>
      setPending((current) =>
        current.map((item) => (item.key === key ? { ...item, ...change } : item)),
      );
    const controller = new AbortController();
    uploads.current.set(key, controller);
    setPending((current) => [...current, { key, name: file.name, status: 'uploading' }]);
    const fail = (error: string): void => {
      uploads.current.delete(key);
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
    uploads.current.delete(key);
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

  const addFiles = (files: readonly File[]): void => {
    if (!allowed || files.length === 0) return;
    const room = allowed.maxPerMessage - pending.length;
    if (files.length > room) {
      setError(t('attachment.tooMany', { count: allowed.maxPerMessage }));
    }
    for (const file of files.slice(0, Math.max(0, room))) void attach(file);
  };

  const cancelUploads = (keys: Iterable<string>): void => {
    for (const key of [...keys]) {
      uploads.current.get(key)?.abort();
      uploads.current.delete(key);
    }
  };

  const removeFile = (file: PendingFile): void => {
    cancelUploads([file.key]);
    revokePreviews([file]);
    setPending((current) => current.filter((item) => item.key !== file.key));
  };

  /** Sends the draft, or a suggested question picked on the welcome screen. */
  const send = async (picked?: string): Promise<void> => {
    const text = (picked ?? draft).trim();
    if (picked === undefined ? !canSend : busy || loading || uploading || text === '') return;
    const files: SentFile[] = ready.flatMap(({ name, kind, previewUrl }) =>
      kind ? [{ name, kind, previewUrl }] : [],
    );
    const handles = ready.flatMap((file) => (file.handle ? [file.handle] : []));
    revokePreviews(pending.filter((file) => file.status !== 'ready'));
    setPending([]);
    if (picked === undefined) setDraft('');
    setError(undefined);
    setBusy(true);
    setMessages((current) => [
      ...current,
      {
        id: nextLocalId(),
        role: 'user',
        text,
        citations: [],
        attachments: files.length,
        files,
        status: 'done',
      },
    ]);
    const context = config.pageContext ? page.context : undefined;
    await client.send({ text, attachments: handles, context }, (event) => {
      const next = activityFor(event, t);
      if (next !== undefined) setActivity(next);
      if (event.type === 'error') {
        setError(event.message);
        setMessages((current) =>
          current.map((message) =>
            message.status === 'streaming' ? { ...message, status: 'error' } : message,
          ),
        );
        return;
      }
      setMessages((current) => applyEvent(current, event));
    });
    setActivity(null);
    setBusy(false);
    inputRef.current?.focus();
  };

  const finishDictation = async (): Promise<void> => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = undefined;
    clearTimeout(limitRef.current);
    setDictation('transcribing');
    const audio = await recording.stop();
    if (audio.size < 1_000) {
      setDictation('idle');
      setError(t('dictation.empty'));
      return;
    }
    const languages = [...navigator.languages.slice(0, 2), config.widget.locale];
    const result = await client.transcribe(audio, languages);
    setDictation('idle');
    if (!result.ok) {
      setError(result.message);
    } else if (result.text) {
      // Into the field, not sent: the visitor checks the transcript first.
      setDraft((current) => (current.trim() ? `${current.trimEnd()} ${result.text}` : result.text));
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const startDictation = async (): Promise<void> => {
    if (!voice || recordingRef.current || startingRef.current) return;
    setError(undefined);
    startingRef.current = true;
    let recording: Recording;
    try {
      recording = await startRecording(voice.maxSeconds);
    } catch (error) {
      setError(t(MICROPHONE_MESSAGES[error instanceof MicrophoneError ? error.reason : 'failed']));
      return;
    } finally {
      startingRef.current = false;
    }
    recordingRef.current = recording;
    setElapsed(0);
    setDictation('recording');
    requestAnimationFrame(() => doneRef.current?.focus());
    limitRef.current = setTimeout(() => void finishDictation(), voice.maxSeconds * 1000);
    const started = performance.now();
    // Only the meter and the clock follow animation frames.
    const tick = (): void => {
      if (recordingRef.current !== recording) return;
      levelRef.current?.style.setProperty('--cd-level', recording.level().toFixed(3));
      setElapsed(Math.min(voice.maxSeconds, Math.floor((performance.now() - started) / 1000)));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const cancelDictation = (): void => {
    discardRecording();
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const startOver = async (): Promise<void> => {
    if (!window.confirm(t('confirm.newConversation'))) return;
    setBusy(true);
    await client.deleteConversation().catch(() => undefined);
    revokePreviews(messages.flatMap((message) => message.files ?? []));
    cancelUploads(uploads.current.keys());
    revokePreviews(pending);
    setPending([]);
    setMessages([]);
    setError(undefined);
    setBusy(false);
    inputRef.current?.focus();
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (!allowed || files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  // Files dropped anywhere on the chat are attached; the attach button covers keyboard users.
  const addFilesRef = useRef(addFiles);
  useEffect(() => {
    addFilesRef.current = addFiles;
  });
  useEffect(() => {
    if (!allowed) return;
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes('Files') ?? false;
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      addFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [allowed]);

  const showWelcome = messages.length === 0 && !loading;
  return (
    <main
      data-cd-part="panel"
      data-dragging={dragging || undefined}
      data-busy={busy || dictation !== 'idle' || undefined}
    >
      <header data-cd-part="header">
        <div data-cd-part="identity">
          <Avatar widget={widget} size="small" />
          <div data-cd-part="identity-text">
            <h1 data-cd-part="title">{widget.title}</h1>
            {widget.subtitle && <p data-cd-part="subtitle">{widget.subtitle}</p>}
          </div>
        </div>
        <div data-cd-part="actions">
          {messages.length > 0 && (
            <button
              type="button"
              data-cd-part="new-conversation"
              aria-label={t('header.newConversation')}
              title={t('header.newConversation')}
              disabled={busy}
              onClick={() => void startOver()}
            >
              <RestartIcon />
            </button>
          )}
          {bridge.embedded && !inline && (
            <button
              type="button"
              data-cd-part="close"
              aria-label={t('header.close')}
              title={t('header.close')}
              onClick={() => {
                discardRecording();
                bridge.close();
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </header>
      <div
        data-cd-part="messages"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading}
      >
        {showWelcome && (
          <Welcome widget={widget} disabled={busy} onPick={(text) => void send(text)} />
        )}
        {loading && (
          <p data-cd-part="status" role="status">
            {t('status.loading')}
          </p>
        )}
        {messages.filter(hasContent).map((message) => (
          <div
            key={message.id}
            data-cd-part="message"
            data-role={message.role}
            data-status={message.status}
          >
            {message.role === 'assistant' && <Avatar widget={widget} size="small" />}
            <div data-cd-part="message-body">
              {message.text !== '' ? (
                <div data-cd-part="bubble">
                  {message.role === 'assistant' ? <Markdown text={message.text} /> : message.text}
                </div>
              ) : (
                message.status === 'streaming' && (
                  <div data-cd-part="bubble">
                    <span data-cd-part="typing" role="img" aria-label={t('status.typing')}>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                )
              )}
              {message.files && message.files.length > 0 ? (
                <FileList files={message.files} part="message-attachments" t={t} />
              ) : (
                message.attachments > 0 && (
                  <p data-cd-part="attachments-note">
                    {pluralText(
                      widget.texts,
                      'message.attachments',
                      message.attachments,
                      widget.locale,
                    )}
                  </p>
                )
              )}
              {message.citations.length > 0 && (
                <ol data-cd-part="citations" aria-label={t('message.sources')}>
                  {message.citations.map((citation) => (
                    <li key={citation.index} data-cd-part="citation">
                      {citation.url ? (
                        <a href={citation.url} target="_blank" rel="noopener noreferrer nofollow">
                          {citation.title}
                        </a>
                      ) : (
                        <span>{citation.title}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ))}
        {activity && (
          <p data-cd-part="status" role="status">
            {activity}
          </p>
        )}
      </div>
      {error && (
        <p data-cd-part="error" role="alert">
          {error}
        </p>
      )}
      <form data-cd-part="composer" onSubmit={onSubmit}>
        {pending.length > 0 && (
          <FileList files={pending} part="attachments" t={t} onRemove={removeFile} />
        )}
        <div data-cd-part="composer-box">
          {dictation === 'idle' ? (
            <>
              {allowed && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    multiple
                    accept={acceptTypes(allowed)}
                    onChange={(event) => {
                      addFiles(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    data-cd-part="attach"
                    aria-label={t('composer.attach')}
                    title={t('composer.attach')}
                    disabled={busy || pending.length >= allowed.maxPerMessage}
                    onClick={() => fileRef.current?.click()}
                  >
                    <AttachIcon />
                  </button>
                </>
              )}
              <textarea
                ref={inputRef}
                data-cd-part="input"
                rows={1}
                value={draft}
                placeholder={widget.placeholder}
                aria-label={widget.placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />
              {voiceAvailable && (
                <button
                  type="button"
                  data-cd-part="voice"
                  aria-label={t('composer.dictate')}
                  title={t('composer.dictate')}
                  onClick={() => void startDictation()}
                >
                  <MicIcon />
                </button>
              )}
              <button
                type="submit"
                data-cd-part="send"
                aria-label={t('composer.send')}
                title={t('composer.send')}
                disabled={!canSend}
              >
                <SendIcon />
              </button>
            </>
          ) : (
            <div data-cd-part="recorder" data-state={dictation}>
              <span data-cd-part="recorder-level" ref={levelRef} aria-hidden="true" />
              <span data-cd-part="recorder-label" role="status">
                {dictation === 'recording' ? t('dictation.listening') : t('dictation.transcribing')}
              </span>
              {dictation === 'recording' && (
                <>
                  <span data-cd-part="recorder-time">
                    {clock(elapsed)} / {clock(voice?.maxSeconds ?? 0)}
                  </span>
                  <button
                    type="button"
                    data-cd-part="recorder-cancel"
                    aria-label={t('dictation.cancel')}
                    title={t('dictation.cancel')}
                    onClick={cancelDictation}
                  >
                    <CloseIcon />
                  </button>
                  <button
                    type="button"
                    data-cd-part="recorder-done"
                    ref={doneRef}
                    onClick={() => void finishDictation()}
                  >
                    {t('dictation.done')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </form>
      {widget.disclosure !== false && (
        <p data-cd-part="disclosure">
          {t('disclosure.text')}
          {widget.disclosure.privacyUrl && (
            <>
              {' '}
              <a href={widget.disclosure.privacyUrl} target="_blank" rel="noopener noreferrer">
                {t('disclosure.privacy')}
              </a>
            </>
          )}
        </p>
      )}
    </main>
  );
}
