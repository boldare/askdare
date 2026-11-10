import { formatText } from '../i18n/format';
import type { TextKey } from '../i18n/texts';
import type { ProtocolEvent } from '../protocol/events';
import type { HistoryMessage } from '../protocol/history';
import type { ChatMessage } from './state';

/** A text in the visitor's language, with `{name}` placeholders filled. */
export type Translate = (
  key: TextKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** Looks texts up in a bot's dictionary; an unknown key shows as itself. */
export function translator(texts: Readonly<Record<string, string>>): Translate {
  return (key, params) => formatText(texts[key] ?? key, params);
}

export const fromHistory = (message: HistoryMessage): ChatMessage => ({
  id: message.id,
  role: message.role,
  text: message.text,
  citations: message.citations,
  attachments: message.attachments,
  status: 'done',
  ...(message.feedback ? { feedback: message.feedback } : {}),
});

/** The messages after one protocol event of a streamed answer. */
export function applyEvent(
  messages: readonly ChatMessage[],
  event: ProtocolEvent,
): readonly ChatMessage[] {
  const update = (
    id: string,
    change: (message: ChatMessage) => ChatMessage,
  ): readonly ChatMessage[] =>
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
      return update(event.messageId, (message) => ({
        ...message,
        status: 'done',
        ...(event.feedback ? { feedback: event.feedback } : {}),
      }));
    default:
      return messages;
  }
}

/** Marks the answer that was streaming when the turn failed. */
export const failStreaming = (messages: readonly ChatMessage[]): readonly ChatMessage[] =>
  messages.map((message) =>
    message.status === 'streaming' ? { ...message, status: 'error' } : message,
  );

/** What the assistant is doing right now, shown while no text streams; undefined: unchanged. */
export function activityFor(event: ProtocolEvent, t: Translate): string | null | undefined {
  if (event.type === 'reasoning') return event.state === 'started' ? t('status.thinking') : null;
  if (event.type === 'tool.status')
    return event.state === 'running'
      ? event.name === 'file_search'
        ? t('status.searching')
        : t('status.tool', { name: event.name })
      : null;
  if (event.type === 'text.delta' || event.type === 'message.end') return null;
  return undefined;
}
