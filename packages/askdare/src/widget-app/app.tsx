import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { acceptTypes } from '../chat/prepare-file';
import type { Translate } from '../chat/reducer';
import { type ChatMessage, canSend, type PendingFile, type SentFile } from '../chat/state';
import type { ChatStore } from '../chat/store';
import { pluralText } from '../i18n/format';
import type { HostBridge } from './host-bridge';
import { AttachIcon, CloseIcon, MicIcon, RestartIcon, SendIcon } from './icons';
import { Markdown } from './markdown';
import { Avatar, Welcome } from './welcome';

/** False for an assistant message that ended (or failed) before any text, files or sources. */
const hasContent = (message: ChatMessage): boolean =>
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
    <ul data-ask-part={part} aria-label={t('attachment.list')}>
      {files.map((file, index) => {
        const pending = 'status' in file ? file : undefined;
        return (
          <li
            key={pending?.key ?? index}
            data-ask-part="attachment"
            data-kind={file.kind}
            data-status={pending?.status}
          >
            {file.previewUrl ? (
              <img data-ask-part="attachment-preview" src={file.previewUrl} alt="" />
            ) : (
              <span data-ask-part="attachment-badge" aria-hidden="true">
                {file.kind === 'image' ? 'IMG' : file.kind === 'pdf' ? 'PDF' : 'FILE'}
              </span>
            )}
            <span data-ask-part="attachment-name">{file.name}</span>
            {pending?.status === 'uploading' && (
              <span data-ask-part="attachment-status">{t('attachment.uploading')}</span>
            )}
            {pending?.status === 'error' && (
              <span data-ask-part="attachment-status" role="alert">
                {pending.error}
              </span>
            )}
            {pending && onRemove && (
              <button
                type="button"
                data-ask-part="attachment-remove"
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

export interface AppProps {
  readonly store: ChatStore;
  readonly bridge: HostBridge;
  /** Inside an element of the host page (data-mode="inline"): no close button. */
  readonly inline?: boolean;
}

export function App({ store, bridge, inline = false }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const { config, actions, t } = store;
  const { messages, draft, busy, error, activity, dictation, elapsed, page } = state;
  const pending = state.files;
  const loading = state.phase === 'loading';
  // The host page may set a greeting and suggestions per page (askdare('configure')).
  const widget = {
    ...config.widget,
    ...(page.greeting ? { greeting: page.greeting } : {}),
    ...(page.starters ? { starters: page.starters } : {}),
  };
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Asking before a new conversation deletes the current one: in the chat, not a browser dialog. */
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  const restartRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirmTextId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = config.voice;
  const levelRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const allowed = config.attachments;

  // Fit the field to its text whenever it changes, typed or not (a transcript, a restored draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field shows draft, which sets its height
  useLayoutEffect(() => {
    if (inputRef.current && dictation === 'idle') fitToContent(inputRef.current);
  }, [draft, dictation]);

  // The store says where focus goes after sending, dictating or starting over.
  useEffect(
    () =>
      store.onFocus((target) => {
        const element = target === 'dictation' ? doneRef : inputRef;
        requestAnimationFrame(() => element.current?.focus());
      }),
    [store],
  );

  // Only the level meter follows animation frames, and it is written to the DOM, not rendered.
  useEffect(() => {
    if (dictation !== 'recording') return;
    let frame = requestAnimationFrame(function tick() {
      const level = store.level();
      if (level !== undefined) levelRef.current?.style.setProperty('--ask-level', level.toFixed(3));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [dictation, store]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // While asking about a new conversation, Escape answers no instead of closing the chat.
      if (confirmingRef.current) {
        setConfirming(false);
        requestAnimationFrame(() => restartRef.current?.focus());
        return;
      }
      // While dictating, Escape cancels the recording instead of closing the chat.
      if (store.getSnapshot().dictation === 'recording') {
        actions.cancelDictation();
        return;
      }
      bridge.close();
    };
    window.addEventListener('keydown', onKey);
    // A floating chat was just opened by the visitor; an inline one only loaded with the page.
    if (!inline) inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, bridge, inline, store]);

  // Follow the conversation, including each streamed delta of the latest message.
  const latestText = messages.at(-1)?.text;
  useEffect(() => {
    const log = logRef.current;
    if (log && latestText !== undefined) log.scrollTop = log.scrollHeight;
  }, [latestText]);

  const askStartOver = (): void => {
    setConfirming(true);
    // Focus starts on Cancel: the safe answer.
    requestAnimationFrame(() => confirmRef.current?.querySelector('button')?.focus());
  };

  const cancelStartOver = (): void => {
    setConfirming(false);
    requestAnimationFrame(() => restartRef.current?.focus());
  };

  /** Keeps Tab inside the question while it is open. */
  const onConfirmKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const startOver = (): void => {
    setConfirming(false);
    void actions.newConversation();
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void actions.send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void actions.send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (!allowed || files.length === 0) return;
    event.preventDefault();
    actions.addFiles(files);
  };

  // Files dropped anywhere on the chat are attached; the attach button covers keyboard users.
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
      actions.addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [actions, allowed]);

  const showWelcome = messages.length === 0 && !loading;
  return (
    <main
      data-ask-part="panel"
      data-dragging={dragging || undefined}
      data-busy={busy || dictation !== 'idle' || undefined}
    >
      <header data-ask-part="header">
        <div data-ask-part="identity">
          <Avatar widget={widget} size="small" />
          <div data-ask-part="identity-text">
            <h1 data-ask-part="title">{widget.title}</h1>
            {widget.subtitle && <p data-ask-part="subtitle">{widget.subtitle}</p>}
          </div>
        </div>
        <div data-ask-part="actions">
          {messages.length > 0 && (
            <button
              ref={restartRef}
              type="button"
              data-ask-part="new-conversation"
              aria-label={t('header.newConversation')}
              aria-haspopup="dialog"
              title={t('header.newConversation')}
              disabled={busy}
              onClick={askStartOver}
            >
              <RestartIcon />
            </button>
          )}
          {bridge.embedded && !inline && (
            <button
              type="button"
              data-ask-part="close"
              aria-label={t('header.close')}
              title={t('header.close')}
              onClick={() => {
                store.hide();
                bridge.close();
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </header>
      {confirming && (
        <div data-ask-part="confirm-backdrop">
          <div
            ref={confirmRef}
            data-ask-part="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-describedby={confirmTextId}
            aria-label={t('header.newConversation')}
            onKeyDown={onConfirmKey}
          >
            <span data-ask-part="confirm-icon" aria-hidden="true">
              <RestartIcon />
            </span>
            <p id={confirmTextId} data-ask-part="confirm-text">
              {t('confirm.newConversation')}
            </p>
            <div data-ask-part="confirm-actions">
              <button type="button" data-ask-part="confirm-cancel" onClick={cancelStartOver}>
                {t('confirm.cancel')}
              </button>
              <button type="button" data-ask-part="confirm-accept" onClick={startOver}>
                {t('confirm.accept')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        data-ask-part="messages"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading}
      >
        {showWelcome && (
          <Welcome
            widget={widget}
            disabled={busy || state.phase !== 'ready'}
            onPick={(text) => void actions.send(text)}
          />
        )}
        {loading && (
          <p data-ask-part="status" role="status">
            {t('status.loading')}
          </p>
        )}
        {messages.filter(hasContent).map((message) => (
          <div
            key={message.id}
            data-ask-part="message"
            data-role={message.role}
            data-status={message.status}
          >
            {message.role === 'assistant' && <Avatar widget={widget} size="small" />}
            <div data-ask-part="message-body">
              {message.text !== '' ? (
                <div data-ask-part="bubble">
                  {message.role === 'assistant' ? <Markdown text={message.text} /> : message.text}
                </div>
              ) : (
                message.status === 'streaming' && (
                  <div data-ask-part="bubble">
                    <span data-ask-part="typing" role="img" aria-label={t('status.typing')}>
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
                  <p data-ask-part="attachments-note">
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
                <ol data-ask-part="citations" aria-label={t('message.sources')}>
                  {message.citations.map((citation) => (
                    <li key={citation.index} data-ask-part="citation">
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
          <p data-ask-part="status" role="status">
            {activity}
          </p>
        )}
      </div>
      {error && (
        <p data-ask-part="error" role="alert">
          {error}
        </p>
      )}
      <form data-ask-part="composer" onSubmit={onSubmit}>
        {pending.length > 0 && (
          <FileList
            files={pending}
            part="attachments"
            t={t}
            onRemove={(file) => actions.removeFile(file.key)}
          />
        )}
        <div data-ask-part="composer-box">
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
                      actions.addFiles(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    data-ask-part="attach"
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
                data-ask-part="input"
                rows={1}
                value={draft}
                placeholder={widget.placeholder}
                aria-label={widget.placeholder}
                onChange={(event) => actions.setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />
              {state.canDictate && (
                <button
                  type="button"
                  data-ask-part="voice"
                  aria-label={t('composer.dictate')}
                  title={t('composer.dictate')}
                  onClick={() => void actions.startDictation()}
                >
                  <MicIcon />
                </button>
              )}
              <button
                type="submit"
                data-ask-part="send"
                aria-label={t('composer.send')}
                title={t('composer.send')}
                disabled={!canSend(state)}
              >
                <SendIcon />
                <span data-ask-part="send-label" aria-hidden="true">
                  {t('composer.send')}
                </span>
              </button>
            </>
          ) : (
            <div data-ask-part="recorder" data-state={dictation}>
              <span data-ask-part="recorder-level" ref={levelRef} aria-hidden="true" />
              <span data-ask-part="recorder-label" role="status">
                {dictation === 'recording' ? t('dictation.listening') : t('dictation.transcribing')}
              </span>
              {dictation === 'recording' && (
                <>
                  <span data-ask-part="recorder-time">
                    {clock(elapsed)} / {clock(voice?.maxSeconds ?? 0)}
                  </span>
                  <button
                    type="button"
                    data-ask-part="recorder-cancel"
                    aria-label={t('dictation.cancel')}
                    title={t('dictation.cancel')}
                    onClick={() => actions.cancelDictation()}
                  >
                    <CloseIcon />
                  </button>
                  <button
                    type="button"
                    data-ask-part="recorder-done"
                    ref={doneRef}
                    onClick={() => void actions.finishDictation()}
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
        <p data-ask-part="disclosure">
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
