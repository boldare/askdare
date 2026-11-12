import type { ThemeVariants } from '../theme/presets';
import type { ChatConfig } from './config';
import { translator } from './reducer';
import type { ChatMessage, ChatState, PendingFile, Rating } from './state';
import { type ChatActions, type ChatStore, focusRequests } from './store';

/** A frozen state for the gallery: design review and visual tests, never a live chat. */
export interface Fixture {
  readonly messages: readonly ChatMessage[];
  readonly pending?: readonly PendingFile[];
  readonly draft?: string;
  readonly busy?: boolean;
  readonly activity?: string;
  readonly error?: string;
  readonly dictation?: 'recording' | 'transcribing';
  readonly elapsed?: number;
  readonly ratings?: Readonly<Record<string, Rating>>;
  readonly commenting?: string;
  /** Theme variants this state shows instead of the bot's, such as where options go. */
  readonly variants?: Partial<ThemeVariants>;
}

const nothing = async (): Promise<void> => {};

/** A store that shows one fixture and talks to no server. Only the draft and focus can change. */
export function createFixtureStore(botConfig: ChatConfig, fixture: Fixture): ChatStore {
  const { widget } = botConfig;
  const config: ChatConfig = fixture.variants
    ? { ...botConfig, widget: { ...widget, variants: { ...widget.variants, ...fixture.variants } } }
    : botConfig;
  let state: ChatState = {
    phase: 'ready',
    busy: fixture.busy ?? false,
    messages: fixture.messages,
    draft: fixture.draft ?? '',
    error: fixture.error,
    activity: fixture.activity ?? null,
    files: fixture.pending ?? [],
    dictation: fixture.dictation ?? 'idle',
    elapsed: fixture.elapsed ?? 0,
    canDictate: config.voice !== undefined,
    page: {},
    ratings: fixture.ratings ?? {},
    commenting: fixture.commenting,
  };
  const initial = state;
  const listeners = new Set<() => void>();
  const set = (change: Partial<ChatState>): void => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  const { focus, onFocus } = focusRequests();
  const actions: ChatActions = {
    send: nothing,
    setDraft: (draft) => set({ draft }),
    addFiles: () => {},
    removeFile: () => {},
    startDictation: nothing,
    finishDictation: nothing,
    cancelDictation: () => {},
    newConversation: nothing,
    rate: nothing,
    dismissComment: () => set({ commenting: undefined }),
    // The field takes focus as in a live chat, so the gallery shows the same state.
    focus: () => focus('input'),
  };
  return {
    config,
    actions,
    t: translator(config.widget.texts),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    start: () => {},
    stop: () => {},
    identify: () => {},
    configure: (page) => set({ page }),
    hide: () => {},
    level: () => undefined,
    onFocus,
    onEvent: () => () => {},
  };
}
