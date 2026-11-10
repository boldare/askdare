import type { ComponentProps, ReactElement } from 'react';
import type { Rating } from '../chat/state';
import { useChatState, useMessage, useStore } from './context';

export interface FeedbackButtonProps extends ComponentProps<'button'> {
  /** What a click rates the answer: 👍 `up` or 👎 `down`. A second click takes the rating back. */
  readonly rating: Rating;
}

/**
 * Rates the answer it is in (ADR-0012), pressed while that is the visitor's rating. Renders
 * nothing for the visitor's own messages, an answer still streaming, or a bot whose answers can't
 * be rated. After 👎 the chat's `state.commenting` names the answer to ask about.
 */
export function FeedbackButton({
  rating,
  onClick,
  ...props
}: FeedbackButtonProps): ReactElement | null {
  const message = useMessage();
  const { actions, t } = useStore();
  const key = message.feedback?.key;
  const current = useChatState((state) => (key ? state.ratings[key] : undefined));
  if (!key || message.role !== 'assistant' || message.status !== 'done') return null;
  const label = t(rating === 'up' ? 'feedback.up' : 'feedback.down');
  return (
    <button
      type="button"
      data-ask-part="feedback-button"
      data-rating={rating}
      aria-pressed={current === rating}
      aria-label={label}
      title={label}
      onClick={(event) => {
        onClick?.(event);
        void actions.rate(message.id, current === rating ? null : rating);
      }}
      {...props}
    />
  );
}
