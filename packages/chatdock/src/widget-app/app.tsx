import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ProtocolEvent } from '../protocol/events';
import type { HistoryMessage } from '../protocol/history';
import type { EmbedConfig } from '../server/embed-page';
import type { ChatClient } from './chat-client';
import type { HostBridge } from './host-bridge';
import { Markdown } from './markdown';
import { acceptTypes, prepareFile } from './prepare-file';

interface Citation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

interface SentFile {
  readonly name: string;
  readonly kind: 'image' | 'pdf';
  /** Local preview of an image sent in this session; history only knows how many files there were. */
  readonly previewUrl?: string | undefined;
}

interface Message {
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

interface PendingFile {
  readonly key: string;
  readonly name: string;
  readonly kind?: 'image' | 'pdf' | undefined;
  readonly previewUrl?: string | undefined;
  readonly status: 'uploading' | 'ready' | 'error';
  readonly handle?: string | undefined;
  readonly error?: string | undefined;
}

const megabytes = (bytes: number): string => `${Math.floor(bytes / 100_000) / 10} MB`;

function revokePreviews(files: readonly { readonly previewUrl?: string | undefined }[]): void {
  for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

function FileList({
  files,
  part,
  onRemove,
}: {
  readonly files: readonly (SentFile | PendingFile)[];
  readonly part: 'attachments' | 'message-attachments';
  readonly onRemove?: (file: PendingFile) => void;
}) {
  return (
    <ul data-cd-part={part} aria-label="Attachments">
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
                {file.kind === 'image' ? 'IMG' : 'PDF'}
              </span>
            )}
            <span data-cd-part="attachment-name">{file.name}</span>
            {pending?.status === 'uploading' && (
              <span data-cd-part="attachment-status">Uploading…</span>
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
                aria-label={`Remove ${file.name}`}
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
  readonly config: EmbedConfig;
  readonly client: ChatClient;
  readonly bridge: HostBridge;
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
function activityFor(event: ProtocolEvent): string | null | undefined {
  if (event.type === 'reasoning') return event.state === 'started' ? 'Thinking…' : null;
  if (event.type === 'tool.status')
    return event.state === 'running'
      ? event.name === 'file_search'
        ? 'Searching documents…'
        : `Using ${event.name}…`
      : null;
  if (event.type === 'text.delta' || event.type === 'message.end') return null;
  return undefined; // unchanged
}

export function App({ config, client, bridge }: AppProps) {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(() => client.hasConversation());
  const [error, setError] = useState<string | undefined>();
  const [activity, setActivity] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowed = config.attachments;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') bridge.close();
    };
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [bridge]);

  // Restore the stored conversation once (about 2 s upstream, so show a loading state).
  useEffect(() => {
    if (!client.hasConversation()) return;
    const controller = new AbortController();
    client
      .loadHistory(controller.signal)
      .then((history) => setMessages(history.map(fromHistory)))
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load the previous conversation.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [client]);

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
    setPending((current) => [...current, { key, name: file.name, status: 'uploading' }]);
    let prepared: Awaited<ReturnType<typeof prepareFile>>;
    try {
      prepared = await prepareFile(file, allowed);
    } catch {
      update({ status: 'error', error: 'This file type is not supported.' });
      return;
    }
    if (prepared.blob.size > allowed.maxBytes) {
      update({ status: 'error', error: `Too large (max ${megabytes(allowed.maxBytes)}).` });
      return;
    }
    const previewUrl = prepared.kind === 'image' ? URL.createObjectURL(prepared.blob) : undefined;
    update({ name: prepared.name, kind: prepared.kind, previewUrl });
    const result = await client.upload(prepared.blob, prepared.name);
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
      setError(`You can attach up to ${allowed.maxPerMessage} files per message.`);
    }
    for (const file of files.slice(0, Math.max(0, room))) void attach(file);
  };

  const removeFile = (file: PendingFile): void => {
    revokePreviews([file]);
    setPending((current) => current.filter((item) => item.key !== file.key));
  };

  const send = async (): Promise<void> => {
    if (!canSend) return;
    const text = draft.trim();
    const files: SentFile[] = ready.flatMap(({ name, kind, previewUrl }) =>
      kind ? [{ name, kind, previewUrl }] : [],
    );
    const handles = ready.flatMap((file) => (file.handle ? [file.handle] : []));
    revokePreviews(pending.filter((file) => file.status !== 'ready'));
    setPending([]);
    setDraft('');
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
    await client.send({ text, attachments: handles }, (event) => {
      const next = activityFor(event);
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

  const startOver = async (): Promise<void> => {
    if (!window.confirm('Start a new conversation? The current one will be deleted.')) return;
    setBusy(true);
    await client.deleteConversation().catch(() => undefined);
    revokePreviews(messages.flatMap((message) => message.files ?? []));
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

  const { widget } = config;
  return (
    <div data-cd-part="panel" data-dragging={dragging || undefined}>
      <header data-cd-part="header">
        <h1 data-cd-part="title">{widget.title}</h1>
        <div data-cd-part="actions">
          {messages.length > 0 && (
            <button
              type="button"
              data-cd-part="new-conversation"
              aria-label="Start a new conversation"
              title="Start a new conversation"
              disabled={busy}
              onClick={() => void startOver()}
            >
              ↺
            </button>
          )}
          {bridge.embedded && (
            <button
              type="button"
              data-cd-part="close"
              aria-label="Close chat"
              onClick={() => bridge.close()}
            >
              ×
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
        <p data-cd-part="greeting">{widget.greeting}</p>
        {loading && (
          <p data-cd-part="status" role="status">
            Loading the conversation…
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            data-cd-part="message"
            data-role={message.role}
            data-status={message.status}
          >
            {message.text !== '' && (
              <div data-cd-part="bubble">
                {message.role === 'assistant' ? <Markdown text={message.text} /> : message.text}
              </div>
            )}
            {message.files && message.files.length > 0 ? (
              <FileList files={message.files} part="message-attachments" />
            ) : (
              message.attachments > 0 && (
                <p data-cd-part="attachments-note">
                  {message.attachments === 1
                    ? '1 attachment'
                    : `${message.attachments} attachments`}
                </p>
              )
            )}
            {message.citations.length > 0 && (
              <ol data-cd-part="citations" aria-label="Sources">
                {message.citations.map((citation) => (
                  <li key={citation.index} data-cd-part="citation">
                    {citation.url ? (
                      <a href={citation.url} target="_blank" rel="noopener noreferrer nofollow">
                        {citation.title}
                      </a>
                    ) : (
                      citation.title
                    )}
                  </li>
                ))}
              </ol>
            )}
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
          <FileList files={pending} part="attachments" onRemove={removeFile} />
        )}
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
              aria-label="Attach files"
              title="Attach files"
              disabled={busy || pending.length >= allowed.maxPerMessage}
              onClick={() => fileRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
                <path
                  d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.1-8.1a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.6-2.6l7.3-7.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
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
        <button type="submit" data-cd-part="send" disabled={!canSend}>
          Send
        </button>
      </form>
    </div>
  );
}
