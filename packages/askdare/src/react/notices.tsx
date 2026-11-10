import type { ComponentProps, ReactElement } from 'react';
import { useChat } from './context';

export type StatusProps = ComponentProps<'p'>;

/** What the chat is doing: loading a conversation, or what the assistant does before it writes. */
export function Status(props: StatusProps): ReactElement | null {
  const { state, t } = useChat();
  const text = state.phase === 'loading' ? t('status.loading') : state.activity;
  if (!text) return null;
  return (
    <p data-ask-part="status" role="status" {...props}>
      {text}
    </p>
  );
}

export type ErrorMessageProps = ComponentProps<'p'>;

/** The latest problem, in the visitor's language, announced to screen readers. */
export function ErrorMessage(props: ErrorMessageProps): ReactElement | null {
  const error = useChat().state.error;
  if (!error) return null;
  return (
    <p data-ask-part="error" role="alert" {...props}>
      {error}
    </p>
  );
}
