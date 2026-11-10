import { FeedbackButton, useChat, useMessage } from '@boldare/askdare/react';
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { ThumbDownIcon, ThumbUpIcon } from './icons';

/** As the server's limit. */
const MAX_COMMENT = 500;

/** Asks what went wrong after a 👎; sending is optional. */
function Comment(): ReactElement {
  const message = useMessage();
  const { actions, t } = useChat();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  // The visitor just pressed 👎: they can type right away.
  useEffect(() => field.current?.focus(), []);
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (text.trim()) void actions.rate(message.id, 'down', text);
    else actions.dismissComment();
  };
  return (
    <form data-ask-part="feedback-comment" onSubmit={onSubmit}>
      <label htmlFor={fieldId}>{t('feedback.comment')}</label>
      <textarea
        ref={field}
        id={fieldId}
        data-ask-part="feedback-comment-input"
        rows={2}
        maxLength={MAX_COMMENT}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div data-ask-part="feedback-comment-actions">
        <button type="button" data-ask-part="feedback-skip" onClick={actions.dismissComment}>
          {t('feedback.skip')}
        </button>
        <button type="submit" data-ask-part="feedback-send" disabled={text.trim() === ''}>
          {t('feedback.send')}
        </button>
      </div>
    </form>
  );
}

/** 👍 and 👎 under an answer that can be rated, and the question after a 👎. */
export function Feedback(): ReactElement | null {
  const message = useMessage();
  const { state, t } = useChat();
  if (!message.feedback || message.role !== 'assistant' || message.status !== 'done') return null;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of two toggle buttons, not a form's fieldset */}
      <div data-ask-part="feedback" role="group" aria-label={t('feedback.label')}>
        <FeedbackButton rating="up">
          <ThumbUpIcon />
        </FeedbackButton>
        <FeedbackButton rating="down">
          <ThumbDownIcon />
        </FeedbackButton>
      </div>
      {state.commenting === message.id && <Comment />}
    </>
  );
}
