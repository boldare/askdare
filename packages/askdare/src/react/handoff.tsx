import type { ComponentProps, ReactElement } from 'react';
import { useChatConfig, useChatState, useMessage, useStore, useTexts } from './context';

export type HandoffButtonProps = ComponentProps<'button'>;

/**
 * "Talk to a person" (ADR-0030): asks for a person for the latest answer, through the chat's own
 * endpoint, with no model call. Its text is `handoff.button` unless you pass children. Renders
 * nothing for a bot without the button and before the first answer, so every handoff belongs to a
 * conversation. `aria-disabled` while a turn runs and while a handoff is under way, so it keeps
 * focus; the outcome shows under that answer (`HandoffStatus`, or the handoff's form).
 */
export function HandoffButton({
  children,
  onClick,
  disabled,
  ...props
}: HandoffButtonProps): ReactElement | null {
  const { handoff } = useChatConfig();
  const { actions } = useStore();
  const t = useTexts();
  // Whether there is an answer yet, and whether it can take a handoff now.
  const ready = useChatState((state) => {
    const answer = state.messages.findLast((message) => message.role === 'assistant');
    if (!answer) return undefined;
    return !state.busy && state.phase === 'ready' && answer.handoff !== 'requested';
  });
  if (!handoff || ready === undefined) return null;
  return (
    <button
      type="button"
      data-ask-part="handoff"
      disabled={disabled}
      // Not `disabled`: the button keeps focus while the request runs.
      aria-disabled={!ready || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (ready && !event.defaultPrevented) void actions.handoff();
      }}
      {...props}
    >
      {children ?? t('handoff.button')}
    </button>
  );
}

export type HandoffStatusProps = ComponentProps<'p'>;

/**
 * Where a handoff for this answer stands, as plain text in the visitor's language: "Connecting
 * you…" while it runs, then its outcome (`data-state` has the state). Announced to screen readers.
 * When the handoff has a form, the form says it instead, so this renders nothing. Use it inside
 * `MessageList`.
 */
export function HandoffStatus(props: HandoffStatusProps): ReactElement | null {
  const { handoff, forms } = useMessage();
  const t = useTexts();
  if (!handoff || forms?.some((form) => form.purpose !== 'lead')) return null;
  return (
    <p data-ask-part="handoff-status" data-state={handoff} role="status" {...props}>
      {t(handoff === 'requested' ? 'handoff.connecting' : `handoff.${handoff}`)}
    </p>
  );
}
