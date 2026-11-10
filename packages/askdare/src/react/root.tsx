import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import type { ChatConfig } from '../chat/config';
import { identityToken, type PageOptions, pageOptions } from '../chat/page-options';
import { createChatStore } from '../chat/store';
import { ChatProvider } from './context';

/** A path on this app, like createChatHandler's `basePath`: never another origin (ADR-0011). */
const BASE_PATH = /^(\/[a-zA-Z0-9._~-]+)+$/;

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
  children,
}: RootProps): ReactElement {
  if (!BASE_PATH.test(config.basePath)) {
    throw new TypeError(
      `[askdare] The chat's basePath must be a path on this app, like /api/chat; got "${config.basePath}".`,
    );
  }
  const page: PageOptions = pageOptions({ greeting, starters, context });
  const [store] = useState(() => createChatStore(config, { page }));

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
