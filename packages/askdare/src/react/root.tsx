import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { isBasePath } from '../base-path';
import type { ChatConfig } from '../chat/config';
import type { ChatEventListener } from '../chat/events';
import { identityToken, type PageOptions, pageOptions } from '../chat/page-options';
import { createChatStore } from '../chat/store';
import { ChatProvider } from './context';

export interface RootProps {
  /** From `getChatConfig()` in a Server Component. */
  readonly config: ChatConfig;
  /**
   * The signed-in visitor: a token from your backend, as for `askdare('identify')`, or null when
   * signed out (ADR-0009). A page that passes one must not be cached.
   */
  readonly identity?: string | null | undefined;
  /** A short description of the page for the assistant, up to 1,000 characters (`pageContext`). */
  readonly context?: string | undefined;
  /** This page's greeting, instead of the bot's. */
  readonly greeting?: string | undefined;
  /** This page's suggested questions, up to 4. */
  readonly starters?: readonly string[] | undefined;
  /**
   * Called with what happens in the chat, for analytics: a message sent, an answer received, a
   * rating (ADR-0013). Metadata only, never the text. A new function doesn't restart the chat.
   */
  readonly onEvent?: ChatEventListener | undefined;
  readonly children?: ReactNode;
}

/**
 * Runs one bot's chat for the components inside it, without rendering any element. Its props
 * take what `askdare('identify')` and `askdare('configure')` take, checked the same way.
 */
export function Root({
  config,
  identity,
  context,
  greeting,
  starters,
  onEvent,
  children,
}: RootProps): ReactElement {
  if (!isBasePath(config.basePath)) {
    throw new TypeError(
      `[askdare] The chat's basePath must be a path on this app, like /api/chat; got "${config.basePath}".`,
    );
  }
  // The stylesheets come from the same route: a config must not point them anywhere else.
  for (const href of Object.values(config.styles ?? {})) {
    if (!href.startsWith(`${config.basePath}/`) || href.includes('//') || href.includes('\\')) {
      throw new TypeError(`[askdare] The chat's stylesheets must come from ${config.basePath}.`);
    }
  }
  const page: PageOptions = pageOptions({ greeting, starters, context });
  // One chat per bot, route and language: another config starts another chat.
  const id = `${config.basePath} ${config.botId} ${config.widget.locale}`;
  const [held, setHeld] = useState(() => ({ id, store: createChatStore(config, { page }) }));
  let { store } = held;
  if (held.id !== id) {
    store = createChatStore(config, { page });
    setHeld({ id, store });
  }

  // The latest function, so a new one per render doesn't resubscribe.
  const listener = useRef(onEvent);
  useEffect(() => {
    listener.current = onEvent;
  }, [onEvent]);
  // Before start(), so the listener hears `ready`.
  useEffect(() => store.onEvent((event) => listener.current?.(event)), [store]);

  // Before start(), so the first request already carries the identity.
  useEffect(() => {
    if (identity === undefined) return;
    const token = identityToken(identity);
    if (token !== undefined) store.identify(token);
  }, [identity, store]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  const key = JSON.stringify(page);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the page options
  useEffect(() => {
    if (JSON.stringify(store.getSnapshot().page) !== key) store.configure(page);
  }, [key, store]);

  return <ChatProvider store={store}>{children}</ChatProvider>;
}
