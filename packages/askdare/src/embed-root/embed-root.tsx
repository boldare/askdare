import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react';
import { bindBridge } from '../chat/bind-bridge';
import type { EmbedChatConfig } from '../chat/config';
import { connectToHost, type HostBridge, holdHandshake } from '../chat/host-bridge';
import { createChatStore } from '../chat/store';
import { followLocale } from '../chat/switch-locale';
import { ChatProvider, type Frame, FrameContext } from '../react/context';
import { noteMissingDisclosure } from '../react/disclosure';
import { checkConfig } from '../react/root';
import { type ToolRenderers, ToolRenderersProvider } from '../react/tool-results';

// Replaced by the app's bundler. Declared here because the React entry builds without Node's types.
declare const process: { readonly env: { readonly NODE_ENV?: string | undefined } };

// From the moment this module loads: the loader sends its handshake once, when the iframe has
// loaded, which can come before the page hydrates and EmbedRoot connects.
holdHandshake();

/**
 * One connection to the loader per page, kept across remounts (React's Strict Mode runs effects
 * twice). A page renders one EmbedRoot: the loader hands one port to the iframe's document.
 */
let bridge: HostBridge | undefined;

export interface EmbedRootProps {
  /** From `getEmbedConfig()` in the page's Server Component. */
  readonly config: EmbedChatConfig;
  /** Your components for tools' results, by tool name, as on `Root` (ADR-0017). */
  readonly toolRenderers?: ToolRenderers | undefined;
  readonly children?: ReactNode;
}

/**
 * `Root` for your own page in the widget's iframe (ADR-0018): the page at a bot's `embedPath`.
 * It connects to the loader on the embedding site exactly as askdare's own iframe does: the
 * visitor's identity, `askdare('configure')`, the events for `askdare('on')`, hiding and closing
 * the panel, and language switches. Put `DefaultChat`, an ejected copy of it or your own markup
 * inside; `DefaultChat` then owns the document and shows a close button. Render one per page.
 */
export function EmbedRoot({ config, toolRenderers, children }: EmbedRootProps): ReactElement {
  checkConfig(config);
  const [store] = useState(() => createChatStore(config));
  const [close, setClose] = useState<(() => void) | undefined>(undefined);
  const inline = config.mode === 'inline';
  // By value: a new config object with the same origins mustn't reconnect, which would stop an
  // answer under way.
  const origins = config.allowedOrigins.join(' ');

  useEffect(() => {
    bridge ??= connectToHost(origins.split(' ').filter(Boolean), { hello: true });
    const connection = bridge;
    // Starts the chat once the loader has handed over the visitor's identity.
    const unbind = bindBridge(store, connection);
    const stopLocale = followLocale(store, connection, unbind);
    // After the children's first render, so a Disclosure among them has marked the chat.
    if (process.env.NODE_ENV !== 'production') noteMissingDisclosure(store);
    if (connection.embedded && !inline) {
      setClose(() => () => {
        store.hide();
        connection.close();
      });
      // The visitor just opened the panel; an inline chat only loaded with the page.
      store.actions.focus();
    }
    return () => {
      stopLocale();
      unbind();
    };
  }, [store, origins, inline]);

  const frame = useMemo<Frame>(() => ({ close }), [close]);
  return (
    <ChatProvider store={store}>
      <ToolRenderersProvider renderers={toolRenderers}>
        <FrameContext.Provider value={frame}>
          {/* What `askdare doctor` looks for on the page. */}
          <div hidden data-askdare-embed="" />
          {children}
        </FrameContext.Provider>
      </ToolRenderersProvider>
    </ChatProvider>
  );
}
