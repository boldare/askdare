import { useChat } from '@boldare/askdare/react';
import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef } from 'react';
import { RestartIcon } from './icons';

/** Keeps Tab inside the question while it is open. */
function trapTab(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

/**
 * Asks before a new conversation deletes the current one: in the chat, not a browser dialog,
 * over the conversation, which stays in view.
 */
export function StartOverQuestion({
  modal,
  busy,
  onCancel,
  onAccept,
}: {
  /** Modal only when the chat is the whole document; inside a page, the page stays usable. */
  readonly modal: boolean;
  /** Accepted and in progress: the icon turns and the buttons wait. */
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onAccept: () => void;
}): ReactElement {
  const { t } = useChat();
  const dialog = useRef<HTMLDivElement>(null);
  const textId = useId();
  useEffect(() => {
    // Focus starts on Cancel: the safe answer.
    const frame = requestAnimationFrame(() => dialog.current?.querySelector('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div data-ask-part="confirm-backdrop">
      <div
        ref={dialog}
        data-ask-part="confirm"
        role="alertdialog"
        aria-modal={modal || undefined}
        aria-describedby={textId}
        aria-label={t('header.newConversation')}
        aria-busy={busy || undefined}
        onKeyDown={trapTab}
      >
        <span data-ask-part="confirm-icon" aria-hidden="true">
          <RestartIcon />
        </span>
        <p id={textId} data-ask-part="confirm-text">
          {t('confirm.newConversation')}
        </p>
        <div data-ask-part="confirm-actions">
          {/* aria-disabled, not disabled: focus stays on the button while the chat starts over. */}
          <button
            type="button"
            data-ask-part="confirm-cancel"
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : onCancel}
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            data-ask-part="confirm-accept"
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : onAccept}
          >
            {t('confirm.accept')}
          </button>
        </div>
      </div>
    </div>
  );
}
