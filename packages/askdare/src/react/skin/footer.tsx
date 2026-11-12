import {
  AttachButton,
  Composer,
  DictateButton,
  Files,
  Input,
  QuickReplies,
  Recorder,
  Send,
  useChat,
} from '@boldare/askdare/react';
import type { ReactElement } from 'react';
import { AttachIcon, CloseIcon, MicIcon, SendIcon } from './icons';

/**
 * The latest answer's options when the theme puts them here, the message field with its buttons
 * (or the dictation in its place), then the AI notice.
 */
export function DefaultFooter(): ReactElement {
  const { state, bot, t } = useChat();
  return (
    <>
      {bot.variants.replies === 'composer' && <QuickReplies data-placement="composer" />}
      <Composer>
        <Files />
        <div data-ask-part="composer-box">
          {state.dictation === 'idle' ? (
            <>
              <AttachButton>
                <AttachIcon />
              </AttachButton>
              <Input />
              <DictateButton>
                <MicIcon />
              </DictateButton>
              <Send>
                <SendIcon />
                <span data-ask-part="send-label" aria-hidden="true">
                  {t('composer.send')}
                </span>
              </Send>
            </>
          ) : (
            <Recorder cancelIcon={<CloseIcon />} />
          )}
        </div>
      </Composer>
      {bot.disclosure !== false && (
        // The AI notice (EU AI Act, art. 50).
        <p data-ask-part="disclosure">
          {t('disclosure.text')}
          {bot.disclosure.privacyUrl && (
            <>
              {' '}
              <a href={bot.disclosure.privacyUrl} target="_blank" rel="noopener noreferrer">
                {t('disclosure.privacy')}
              </a>
            </>
          )}
        </p>
      )}
    </>
  );
}
