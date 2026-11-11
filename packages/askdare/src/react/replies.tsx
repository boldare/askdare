import type { ComponentProps, ReactElement } from 'react';
import { useChatState, useMessage, useStore } from './context';

export type QuickRepliesProps = ComponentProps<'div'>;

/**
 * The options the latest answer offers (ADR-0015): a group (`replies`) of buttons (`reply`), each
 * showing its option as plain text, never Markdown. A click sends the option as the visitor's own
 * message, exactly as if they had typed it. Renders nothing for any other message, so the options
 * go away as soon as the visitor sends anything.
 */
export function QuickReplies(props: QuickRepliesProps): ReactElement | null {
  const message = useMessage();
  const { actions, t } = useStore();
  const latest = useChatState((state) => state.messages.at(-1)?.id === message.id);
  const disabled = useChatState((state) => state.busy || state.phase !== 'ready');
  const { replies } = message;
  if (!latest || message.role !== 'assistant' || message.status !== 'done' || !replies?.length) {
    return null;
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of buttons that send, not a form's fieldset
    <div data-ask-part="replies" role="group" aria-label={t('message.replies')} {...props}>
      {replies.map((reply) => (
        <button
          key={reply}
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
