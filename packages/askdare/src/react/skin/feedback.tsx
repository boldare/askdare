import { FeedbackButton, useChat, useChatState, useMessage } from '@boldare/askdare/react';
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { useSkin } from './context';
import { ThumbDownIcon, ThumbUpIcon } from './icons';

/** As the server's limit. */
const MAX_COMMENT = 500;

/** Asks what went wrong after a 👎; sending is optional. */
function Comment(): ReactElement {
  const message = useMessage();
  const { actions, t } = useChat();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  // The visitor just pressed 👎: they can type right away.
  useEffect(() => field.current?.focus(), []);
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!text.trim()) {
      actions.dismissComment();
      return;
    }
    // The form stays until the comment is sent; if it isn't, the text is still here to retry.
    setSending(true);
    void actions.rate(message.id, 'down', text).finally(() => setSending(false));
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
        <button
          type="submit"
          data-ask-part="feedback-send"
          disabled={sending || text.trim() === ''}
        >
          {t('feedback.send')}
        </button>
      </div>
    </form>
  );
}

/** 👍 and 👎 under an answer that can be rated, and the question after a 👎. */
export function Feedback(): ReactElement | null {
  const message = useMessage();
  const { t } = useSkin();
  const commenting = useChatState((state) => state.commenting === message.id);
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
      {commenting && <Comment />}
    </>
  );
}
