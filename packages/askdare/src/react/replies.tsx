import type { ComponentProps, ReactElement } from 'react';
import { useChatState, useOptionalMessage, useStore } from './context';

export type QuickRepliesProps = ComponentProps<'div'>;

/**
 * The options the latest answer offers (ADR-0015): a group (`replies`) of buttons (`reply`), each
 * showing its option as plain text, never Markdown. A click sends the option as the visitor's own
 * message, exactly as if they had typed it. Inside `MessageList` it renders under the latest
 * answer only; anywhere else, such as above the message field, it shows the latest answer's
 * options. Either way the options go away as soon as the visitor sends anything.
 */
export function QuickReplies(props: QuickRepliesProps): ReactElement | null {
  const own = useOptionalMessage();
  const { actions, t } = useStore();
  const replies = useChatState((state) => {
    const latest = state.messages.at(-1);
    if (latest?.role !== 'assistant' || latest.status !== 'done') return undefined;
    return own && own.id !== latest.id ? undefined : latest.replies;
  });
  const disabled = useChatState((state) => state.busy || state.phase !== 'ready');
  if (!replies?.length) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons that send, not a form's fieldset
    <div data-ask-part="replies" role="group" aria-label={t('message.replies')} {...props}>
      {replies.map((reply, index) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: options never move, and may repeat in custom state
          key={index}
          type="button"
          data-ask-part="reply"
          disabled={disabled}
          onClick={() => void actions.send(reply)}
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
