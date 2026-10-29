import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ProtocolEvent } from '../protocol/events';
import type { HistoryMessage } from '../protocol/history';
import type { EmbedConfig } from '../server/embed-page';
import type { ChatClient } from './chat-client';
import type { HostBridge } from './host-bridge';
import { Markdown } from './markdown';

interface Citation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

interface Message {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly attachments: number;
  readonly status: 'streaming' | 'done' | 'error';
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
    return event.state === 'running' ? `Using ${event.name}…` : null;
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
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || busy || loading) return;
    setDraft('');
    setError(undefined);
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: nextLocalId(), role: 'user', text, citations: [], attachments: 0, status: 'done' },
    ]);
    await client.send(text, (event) => {
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

  const { widget } = config;
  return (
    <div data-cd-part="panel">
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
            {message.attachments > 0 && (
              <p data-cd-part="attachments-note">
                {message.attachments === 1 ? '1 attachment' : `${message.attachments} attachments`}
              </p>
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
        <textarea
          ref={inputRef}
          data-cd-part="input"
          rows={1}
          value={draft}
          placeholder={widget.placeholder}
          aria-label={widget.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" data-cd-part="send" disabled={busy || loading || draft.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}
