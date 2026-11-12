import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { ChatAttachments } from '../chat/config';
import type { Translate } from '../chat/reducer';
import type { ChatMessage, ChatState } from '../chat/state';
import type { ChatActions, ChatStore } from '../chat/store';
import type { PresetName, ThemeVariants } from '../theme/presets';

/** The bot as the visitor sees it: its settings, with the page's greeting and starters applied. */
export interface ChatBot {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly greeting: string;
  readonly starters: readonly string[];
  readonly placeholder: string;
  /** The picture configured for the assistant, if any. */
  readonly avatar: string | undefined;
  /** The language the visitor sees. */
  readonly locale: string;
  /** The AI notice under the message field, with an optional privacy policy link; false when off. */
  readonly disclosure: false | { readonly privacyUrl: string | undefined };
  readonly preset: PresetName;
  readonly variants: ThemeVariants;
  /** What visitors may attach; undefined when attachments are off. */
  readonly attachments: ChatAttachments | undefined;
  /** Longest dictation in seconds; undefined when voice input is off. */
  readonly maxDictationSeconds: number | undefined;
  /** Every text in the visitor's language, plural forms included. */
  readonly texts: Readonly<Record<string, string>>;
}

export interface Chat {
  readonly state: ChatState;
  readonly actions: ChatActions;
  readonly bot: ChatBot;
  /** A text in the visitor's language by its key, such as `composer.send`. */
  readonly t: Translate;
}

const StoreContext = createContext<ChatStore | null>(null);
const MessageContext = createContext<ChatMessage | null>(null);

/** Provides a chat store to the primitives below. `Root` creates one; the iframe brings its own. */
export function ChatProvider({
  store,
  children,
}: {
  readonly store: ChatStore;
  readonly children?: ReactNode;
}): ReactElement {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/** The store of the surrounding chat. Throws outside `Root`, with a hint. */
export function useStore(): ChatStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('[askdare] Chat components must be inside <Root>.');
  return store;
}

/** The chat's state; re-renders on every change. */
function useSnapshot(store: ChatStore): ChatState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/** The whole chat: its state, actions, bot settings and texts. Re-renders on every change. */
export function useChat(): Chat {
  const store = useStore();
  const state = useSnapshot(store);
  const { config } = store;
  const { page } = state;
  const bot = useMemo<ChatBot>(
    () => ({
      id: config.botId,
      title: config.widget.title,
      subtitle: config.widget.subtitle,
      greeting: page.greeting ?? config.widget.greeting,
      starters: page.starters ?? config.widget.starters,
      placeholder: config.widget.placeholder,
      avatar: config.widget.avatar,
      locale: config.widget.locale,
      disclosure: config.widget.disclosure,
      preset: config.widget.preset,
      variants: config.widget.variants,
      attachments: config.attachments,
      maxDictationSeconds: config.voice?.maxSeconds,
      texts: config.widget.texts,
    }),
    [config, page],
  );
  return { state, actions: store.actions, bot, t: store.t };
}

/**
 * One value from the chat's state, such as `useChatState((state) => state.busy)`. Re-renders only
 * when that value changes, so return a primitive or a part of the state, not a new object.
 */
export function useChatState<T>(select: (state: ChatState) => T): T {
  const store = useStore();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(store.getServerSnapshot()),
  );
}

/** Provides one message to the components inside `MessageList`. */
export function MessageProvider({
  message,
  children,
}: {
  readonly message: ChatMessage;
  readonly children?: ReactNode;
}): ReactElement {
  return <MessageContext.Provider value={message}>{children}</MessageContext.Provider>;
}

/** The message being rendered, or null outside `MessageList`. */
export function useOptionalMessage(): ChatMessage | null {
  return useContext(MessageContext);
}

/** The message being rendered, inside `MessageList`. */
export function useMessage(): ChatMessage {
  const message = useContext(MessageContext);
  if (!message) throw new Error('[askdare] useMessage() works only inside <MessageList>.');
  return message;
}
