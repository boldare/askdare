import {
  ErrorMessage,
  MessageList,
  Messages,
  Panel,
  Status,
  useChat,
} from '@boldare/askdare/react';
import {
  type ComponentType,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StartOverQuestion } from './confirm';
import { type Skin, SkinContext } from './context';
import { DefaultFooter } from './footer';
import { DefaultHeader } from './header';
import { DefaultMessage } from './message';
import { DefaultWelcome } from './welcome';

/** Parts of the default look you can replace. They take no props: read the chat with the hooks. */
export interface DefaultChatComponents {
  readonly Header?: ComponentType;
  readonly Welcome?: ComponentType;
  /** Rendered for each message; `useMessage()` gives the message. */
  readonly Message?: ComponentType;
  /** The message field and the AI notice under it. */
  readonly Footer?: ComponentType;
}

export interface DefaultPanelProps {
  /** Level of the chat's title (default 2); 1 makes the chat the page's main landmark. */
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5;
  /** Shows a close button, and Escape calls it too. */
  readonly onClose?: (() => void) | undefined;
  readonly components?: DefaultChatComponents | undefined;
}

/** The default look of the chat inside its frame: header, conversation and message field. */
export function DefaultPanel({
  headingLevel = 2,
  onClose,
  components = {},
}: DefaultPanelProps): ReactElement {
  const { state, actions } = useChat();
  const [confirming, setConfirming] = useState(false);
  const restartRef = useRef<HTMLButtonElement>(null);
  const askStartOver = useCallback(() => setConfirming(true), []);
  const skin = useMemo<Skin>(
    () => ({ headingLevel, onClose, askStartOver, restartRef }),
    [headingLevel, onClose, askStartOver],
  );

  const cancelStartOver = (): void => {
    setConfirming(false);
    requestAnimationFrame(() => restartRef.current?.focus());
  };

  // Escape answers the question, else cancels a dictation, else closes the chat.
  const onEscape = useRef(() => {});
  onEscape.current = () => {
    if (confirming) cancelStartOver();
    else if (state.dictation === 'recording') actions.cancelDictation();
    else onClose?.();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Header = components.Header ?? DefaultHeader;
  const Welcome = components.Welcome ?? DefaultWelcome;
  const Message = components.Message ?? DefaultMessage;
  const Footer = components.Footer ?? DefaultFooter;
  const showWelcome = state.messages.length === 0 && state.phase !== 'loading';
  return (
    <SkinContext.Provider value={skin}>
      <Panel landmark={headingLevel === 1 ? 'main' : 'region'}>
        <Header />
        {confirming && (
          <StartOverQuestion
            onCancel={cancelStartOver}
            onAccept={() => {
              setConfirming(false);
              void actions.newConversation();
            }}
          />
        )}
        <Messages>
          {showWelcome && <Welcome />}
          <MessageList>
            <Message />
          </MessageList>
          <Status />
        </Messages>
        <ErrorMessage />
        <Footer />
      </Panel>
    </SkinContext.Provider>
  );
}
