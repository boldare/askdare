import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ProtocolEvent } from '../protocol/events';
import type { EmbedConfig } from '../server/embed-page';
import type { ChatClient } from './chat-client';
import type { HostBridge } from './host-bridge';

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
  readonly status: 'streaming' | 'done' | 'error';
}

export interface AppProps {
  readonly config: EmbedConfig;
  readonly client: ChatClient;
  readonly bridge: HostBridge;
}

let localId = 0;
const nextLocalId = (): string => `local_${++localId}`;

function applyEvent(messages: readonly Message[], event: ProtocolEvent): readonly Message[] {
  const update = (id: string, change: (message: Message) => Message): readonly Message[] =>
    messages.map((message) => (message.id === id ? change(message) : message));
  switch (event.type) {
    case 'message.start':
      return [
        ...messages,
        { id: event.messageId, role: 'assistant', text: '', citations: [], status: 'streaming' },
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

export function App({ config, client, bridge }: AppProps) {
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [thinking, setThinking] = useState(false);
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

  // Follow the conversation, including each streamed delta of the latest message.
  const latestText = messages.at(-1)?.text;
  useEffect(() => {
    const log = logRef.current;
    if (log && latestText !== undefined) log.scrollTop = log.scrollHeight;
  }, [latestText]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setError(undefined);
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: nextLocalId(), role: 'user', text, citations: [], status: 'done' },
    ]);
    await client.send(text, (event) => {
      if (event.type === 'reasoning') setThinking(event.state === 'started');
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
    setThinking(false);
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
      </header>
      <div
        data-cd-part="messages"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <p data-cd-part="greeting">{widget.greeting}</p>
        {messages.map((message) => (
          <div
            key={message.id}
            data-cd-part="message"
            data-role={message.role}
            data-status={message.status}
          >
            <div data-cd-part="bubble">{message.text}</div>
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
        {thinking && (
          <p data-cd-part="status" role="status">
            Thinking…
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
        <button type="submit" data-cd-part="send" disabled={busy || draft.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}
