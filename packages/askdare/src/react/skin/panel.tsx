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
  ownsDocument = false,
}: DefaultPanelProps & {
  /** The chat is the whole document, as in its iframe: Escape works wherever focus is. */
  readonly ownsDocument?: boolean;
}): ReactElement {
  const { state, actions, bot, t } = useChat();
  const [confirming, setConfirming] = useState(false);
  /** Accepted, and the server is deleting the conversation: the question stays, busy, until then. */
  const [restarting, setRestarting] = useState(false);
  const restartRef = useRef<HTMLButtonElement>(null);
  const askStartOver = useCallback(() => setConfirming(true), []);
  const skin = useMemo<Skin>(
    () => ({ bot, t, headingLevel, onClose, askStartOver, restartRef }),
    [bot, t, headingLevel, onClose, askStartOver],
  );

  const cancelStartOver = (): void => {
    if (restarting) return;
    setConfirming(false);
    requestAnimationFrame(() => restartRef.current?.focus());
  };

  // Escape answers a question of the chat, else cancels a dictation, else closes the chat. Inside a page,
  // only when it is pressed in the chat; as the whole document (the iframe), wherever focus is.
  const main = headingLevel === 1;
  const panelRef = useRef<HTMLElement>(null);
  const onEscape = useRef(() => {});
  onEscape.current = () => {
    if (confirming) cancelStartOver();
    else if (state.commenting !== undefined) actions.dismissComment();
    else if (state.dictation === 'recording') actions.cancelDictation();
    else onClose?.();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Not when a handler already used it, or while an input method composes text.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const inside = event.target instanceof Node && panelRef.current?.contains(event.target);
      if (ownsDocument || inside) onEscape.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ownsDocument]);

  const Header = components.Header ?? DefaultHeader;
  const Welcome = components.Welcome ?? DefaultWelcome;
  const Message = components.Message ?? DefaultMessage;
  const Footer = components.Footer ?? DefaultFooter;
  // The same element on every render, so only the message that changed renders again.
  const message = useMemo(() => <Message />, [Message]);
  const showWelcome = state.messages.length === 0 && state.phase !== 'loading';
  return (
    <SkinContext.Provider value={skin}>
      <Panel ref={panelRef} landmark={main ? 'main' : 'region'}>
        <Header />
        {confirming && (
          <StartOverQuestion
            modal={ownsDocument}
            busy={restarting}
            onCancel={cancelStartOver}
            onAccept={async () => {
              setRestarting(true);
              await actions.newConversation();
              setRestarting(false);
              setConfirming(false);
            }}
          />
        )}
        <Messages>
          {showWelcome && <Welcome />}
          <MessageList>{message}</MessageList>
          <Status />
        </Messages>
        <ErrorMessage />
        <Footer />
      </Panel>
    </SkinContext.Provider>
  );
}
