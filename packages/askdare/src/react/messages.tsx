import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
} from 'react';
import type { ChatMessage, PendingFile, SentFile } from '../chat/state';
import { pluralText } from '../i18n/format';
import { MessageProvider, useChatState, useMessage, useStore } from './context';
import { Markdown, safeUrl } from './markdown';
import { useMergedRef } from './refs';

/** False for an answer that ended (or failed) before any text, files or sources. */
const hasContent = (message: ChatMessage): boolean =>
  message.role === 'user' ||
  message.status === 'streaming' ||
  message.text !== '' ||
  message.citations.length > 0;

export type MessagesProps = ComponentProps<'div'>;

/**
 * The conversation: a live region that follows the latest message as it streams. Holds the
 * welcome, the `MessageList` and the `Status`.
 */
export function Messages({ ref, ...props }: MessagesProps): ReactElement {
  const own = useRef<HTMLDivElement>(null);
  const loading = useChatState((state) => state.phase === 'loading');
  const latestText = useChatState((state) => state.messages.at(-1)?.text);
  // Follow the conversation, including each streamed delta of the latest message.
  useEffect(() => {
    const log = own.current;
    if (log && latestText !== undefined) log.scrollTop = log.scrollHeight;
  }, [latestText]);
  return (
    <div
      data-ask-part="messages"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={loading}
      {...props}
      ref={useMergedRef(own, ref)}
    />
  );
}

export interface MessageListProps {
  /** Rendered once per message; read the message with `useMessage()`. */
  readonly children?: ReactNode;
}

/** Renders its children for every message worth showing. Has no element of its own. */
export function MessageList({ children }: MessageListProps): ReactElement {
  const messages = useChatState((state) => state.messages);
  return (
    <>
      {messages.filter(hasContent).map((message) => (
        <MessageProvider key={message.id} message={message}>
          {children}
        </MessageProvider>
      ))}
    </>
  );
}

export type MessageProps = ComponentProps<'div'>;

/**
 * One message, with `data-role` and `data-status`. The message primitives read only their own
 * message, so a streaming answer doesn't re-render the earlier ones.
 */
export function Message(props: MessageProps): ReactElement {
  const message = useMessage();
  return (
    <div data-ask-part="message" data-role={message.role} data-status={message.status} {...props} />
  );
}

export type MessageTextProps = ComponentProps<'div'>;

/**
 * The message's bubble: the visitor's text as typed, an answer as Markdown, and typing dots while
 * an answer has no text yet.
 */
export function MessageText(props: MessageTextProps): ReactElement | null {
  const message = useMessage();
  const { t } = useStore();
  if (message.text !== '') {
    return (
      <div data-ask-part="bubble" {...props}>
        {message.role === 'assistant' ? <Markdown text={message.text} /> : message.text}
      </div>
    );
  }
  if (message.status !== 'streaming') return null;
  return (
    <div data-ask-part="bubble" {...props}>
      <span data-ask-part="typing" role="img" aria-label={t('status.typing')}>
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export type CitationsProps = ComponentProps<'ol'>;

/** The sources of an answer. Links go through the same check as links in answers. */
export function Citations(props: CitationsProps): ReactElement | null {
  const message = useMessage();
  const { t } = useStore();
  if (message.citations.length === 0) return null;
  return (
    <ol data-ask-part="citations" aria-label={t('message.sources')} {...props}>
      {message.citations.map((citation) => {
        const href = citation.url ? safeUrl(citation.url) : '';
        return (
          <li key={citation.index} data-ask-part="citation">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {citation.title}
              </a>
            ) : (
              <span>{citation.title}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface FileListProps extends ComponentProps<'ul'> {
  readonly files: readonly (SentFile | PendingFile)[];
  /** Picked for the next message, or sent with this one. */
  readonly list: 'attachments' | 'message-attachments';
  readonly onRemove?: ((file: PendingFile) => void) | undefined;
}

/** Files of a message, or those picked for the next one (which can be removed). */
export function FileList({ files, list, onRemove, ...props }: FileListProps): ReactElement {
  const { t } = useStore();
  return (
    <ul data-ask-part={list} aria-label={t('attachment.list')} {...props}>
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

export type MessageFilesProps = Omit<ComponentProps<'ul'>, 'ref'> & {
  readonly ref?: Ref<HTMLElement>;
};

/**
 * The files sent with a message: previews from this visit, or after a reload only how many there
 * were (`attachments-note`).
 */
export function MessageFiles({ ref, ...props }: MessageFilesProps): ReactElement | null {
  const message = useMessage();
  const { widget } = useStore().config;
  if (message.files && message.files.length > 0) {
    return (
      <FileList
        files={message.files}
        list="message-attachments"
        {...props}
        ref={ref as Ref<HTMLUListElement>}
      />
    );
  }
  if (message.attachments === 0) return null;
  return (
    <p
      data-ask-part="attachments-note"
      {...(props as ComponentProps<'p'>)}
      ref={ref as Ref<HTMLParagraphElement>}
    >
      {pluralText(widget.texts, 'message.attachments', message.attachments, widget.locale)}
    </p>
  );
}
