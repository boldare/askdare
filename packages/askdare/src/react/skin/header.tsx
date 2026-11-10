import { useChat } from '@boldare/askdare/react';
import type { ReactElement } from 'react';
import { Avatar } from './avatar';
import { heading, useSkin } from './context';
import { CloseIcon, RestartIcon } from './icons';

/** The bot's name and picture, a new-conversation button and, when it can close, a close button. */
export function DefaultHeader(): ReactElement {
  const { state, bot, t } = useChat();
  const { headingLevel, onClose, askStartOver, restartRef } = useSkin();
  const Title = heading(headingLevel);
  return (
    <header data-ask-part="header">
      <div data-ask-part="identity">
        <Avatar size="small" />
        <div data-ask-part="identity-text">
          <Title data-ask-part="title">{bot.title}</Title>
          {bot.subtitle && <p data-ask-part="subtitle">{bot.subtitle}</p>}
        </div>
      </div>
      <div data-ask-part="actions">
        {state.messages.length > 0 && (
          <button
            ref={restartRef}
            type="button"
            data-ask-part="new-conversation"
            aria-label={t('header.newConversation')}
            aria-haspopup="dialog"
            title={t('header.newConversation')}
            disabled={state.busy}
            onClick={askStartOver}
          >
            <RestartIcon />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            data-ask-part="close"
            aria-label={t('header.close')}
            title={t('header.close')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </header>
  );
}
