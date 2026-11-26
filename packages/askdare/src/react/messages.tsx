import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ChatMessage, PendingFile, SentFile } from '../chat/state';
import { pluralText } from '../i18n/format';
import {
  MessageProvider,
  useChatConfig,
  useChatState,
  useMessage,
  useStore,
  useTexts,
} from './context';
import { Markdown, safeUrl } from './markdown';
import { useMergedRef } from './refs';

/** False for an answer that ended (or failed) before any text or sources, or options to show. */
const hasContent = (message: ChatMessage): boolean =>
  message.role === 'user' ||
  message.status === 'streaming' ||
  message.text !== '' ||
  message.citations.length > 0 ||
  (message.status === 'done' && (message.replies?.length ?? 0) > 0) ||
  // An answer may be only a form, or a handoff's status.
  message.handoff !== undefined ||
  (message.forms?.length ?? 0) > 0;

export type MessagesProps = ComponentProps<'div'>;

/** Visually hidden, but read by screen readers. */
const hidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The conversation, following the latest message as it streams. Holds the welcome, `LoadEarlier`,
 * the `MessageList` and the `Status`. It is a log but not a live region: text growing inside a node
 * is read in fragments or not at all, so a finished answer is announced once, through a status
 * region next to it. Older messages loaded above keep the visitor's place, and are announced there.
 */
export function Messages({ ref, ...props }: MessagesProps): ReactElement {
  const own = useRef<HTMLDivElement>(null);
  const streaming = useRef<string>(undefined);
  const [finished, setFinished] = useState('');
  const t = useTexts();
  const loading = useChatState((state) => state.phase === 'loading');
  const latest = useChatState((state) => state.messages.at(-1));
  const commenting = useChatState((state) => state.commenting);
  const first = useChatState((state) => state.messages[0]?.id);
  const loadingEarlier = useChatState((state) => state.earlier === 'loading');
  const shown = useRef(first);
  const log = own.current;
  // How far from the bottom the visitor reads, before older messages go in above.
  const fromBottom = first !== shown.current && log ? log.scrollHeight - log.scrollTop : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the oldest message changes
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = first;
    // Only when messages went in above others, not when a conversation loads or starts.
    if (!log || !previous || !first) return;
    log.scrollTop = log.scrollHeight - fromBottom;
    setFinished(t('history.loaded'));
  }, [first]);
  // Cleared while they load, so the same words are announced again for the next page.
  useEffect(() => {
    if (loadingEarlier) setFinished('');
  }, [loadingEarlier]);
  // Follow the conversation: each streamed delta of the latest message, what its end adds (such as
  // the rating buttons), and the question after a 👎.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commenting changes what is below the latest message
  useEffect(() => {
    const log = own.current;
    if (!log || !latest) return;
    log.scrollTop = log.scrollHeight;
    if (latest.role !== 'assistant') return;
    if (latest.status === 'streaming') {
      if (streaming.current !== latest.id) setFinished('');
      streaming.current = latest.id;
    } else if (streaming.current === latest.id) {
      // Only answers that streamed in this visit: a restored conversation is not read out.
      streaming.current = undefined;
      // The rendered answer, so Markdown syntax is not read out.
      const bubbles = log.querySelectorAll('[data-ask-part="bubble"]');
      if (latest.status === 'done' && latest.text !== '') {
        setFinished(bubbles[bubbles.length - 1]?.textContent || latest.text);
      }
    }
  }, [latest, commenting]);
  return (
    <>
      <div
        data-ask-part="messages"
        role="log"
        aria-live="off"
        aria-busy={loading}
        {...props}
        ref={useMergedRef(own, ref)}
      />
      <div data-ask-part="announcement" role="status" style={hidden}>
        {finished}
      </div>
    </>
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

export type LoadEarlierProps = ComponentProps<'button'>;

/**
 * Loads the conversation's older messages, a page at a time: a button for the top of `Messages`,
 * shown while there are any (`state.earlier`). It also loads them when the visitor scrolls up to
 * it. While they load it keeps focus, with `data-loading`. Focus stays on it, in view, with the
 * older messages under it; when the conversation's start is reached and it goes away, the oldest
 * message takes focus.
 */
export function LoadEarlier({
  ref,
  children,
  onClick,
  ...props
}: LoadEarlierProps): ReactElement | null {
  const earlier = useChatState((state) => state.earlier);
  const { actions } = useStore();
  const t = useTexts();
  const own = useRef<HTMLButtonElement>(null);
  const merged = useMergedRef(own, ref);
  const shown = earlier !== 'none';
  const button = own.current;
  // Read before the update: a button that goes away can't say whether it had focus.
  const focused =
    button?.ownerDocument.activeElement === button ? button?.closest('[role="log"]') : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a page loaded
  useLayoutEffect(() => {
    if (!focused) return;
    // After Messages kept the visitor's place, which a keyboard visitor has here instead.
    queueMicrotask(() => {
      const first = focused.querySelector<HTMLElement>('[data-ask-part="message"]');
      if (own.current) own.current.scrollIntoView({ block: 'nearest' });
      else if (first) {
        first.tabIndex = -1;
        first.focus();
      }
    });
  }, [earlier]);
  useEffect(() => {
    const target = own.current;
    if (!shown || !target || typeof IntersectionObserver !== 'function') return;
    let seen = false;
    const observer = new IntersectionObserver((entries) => {
      // Not on the first look: a chat opens at the latest message, and loads only on scrolling up.
      if (entries.at(-1)?.isIntersecting && seen) void actions.loadEarlier();
      seen = true;
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [shown, actions]);
  if (!shown) return null;
  const busy = earlier === 'loading';
  return (
    <button
      type="button"
      data-ask-part="load-earlier"
      data-loading={busy ? '' : undefined}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        onClick?.(event);
        void actions.loadEarlier();
      }}
      {...props}
      ref={merged}
    >
      {children ?? t(busy ? 'history.loading' : 'history.earlier')}
    </button>
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
  const t = useTexts();
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
  const t = useTexts();
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
  const t = useTexts();
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
  const { widget } = useChatConfig();
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
