import { formatText } from '../i18n/format';
import type { TextKey } from '../i18n/texts';
import type { ProtocolEvent } from '../protocol/events';
import { MAX_MESSAGE_FORMS } from '../protocol/forms';
import type { HistoryMessage } from '../protocol/history';
import { MAX_TOOL_UI } from '../protocol/tool-ui';
import type { ChatMessage, MessageForm } from './state';

/** A text in the visitor's language, with `{name}` placeholders filled. */
export type Translate = (
  key: TextKey,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** Looks texts up in a bot's dictionary; an unknown key shows as itself. */
export function translator(texts: Readonly<Record<string, string>>): Translate {
  return (key, params) => formatText(texts[key] ?? key, params);
}

/** A message of `POST /history`, which `parseHistory` built from known fields only. */
export const fromHistory = (message: HistoryMessage): ChatMessage => ({
  ...message,
  status: 'done',
  handoff: message.handoff?.state,
});

/** Changes the form with this handle. */
export const changeForm = (
  messages: readonly ChatMessage[],
  handle: string,
  change: Partial<MessageForm>,
): readonly ChatMessage[] =>
  messages.map((message) =>
    message.forms?.some((form) => form.handle === handle)
      ? {
          ...message,
          forms: message.forms.map((form) =>
            form.handle === handle ? { ...form, ...change } : form,
          ),
        }
      : message,
  );

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
    case 'tool.ui': {
      // parseEvent checked the payload; a fifth one or a call seen before is ignored.
      const { callId, name, data } = event;
      const payload = { callId, name, data };
      return update(event.messageId, (message) => {
        const ui = message.ui ?? [];
        if (ui.length >= MAX_TOOL_UI || ui.some((item) => item.callId === callId)) return message;
        return { ...message, ui: [...ui, payload] };
      });
    }
    case 'handoff':
      return update(event.messageId, (message) => ({ ...message, handoff: event.state }));
    case 'form': {
      // A call seen before, or one over the limit, is ignored.
      const { callId, name, handle, purpose } = event;
      return update(event.messageId, (message) => {
        const forms = message.forms ?? [];
        return forms.length >= MAX_MESSAGE_FORMS || forms.some((form) => form.callId === callId)
          ? message
          : { ...message, forms: [...forms, { callId, name, purpose, handle, state: 'open' }] };
      });
    }
    case 'replies':
      return update(event.messageId, (message) => ({ ...message, replies: event.items }));
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
      ? event.name === 'file_search' || event.name === 'search_knowledge'
        ? t('status.searching')
        : t('status.tool', { name: event.name })
      : null;
  if (event.type === 'text.delta' || event.type === 'message.end') return null;
  return undefined;
}
