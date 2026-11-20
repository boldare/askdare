import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from 'react';
import { bindBridge } from '../chat/bind-bridge';
import type { EmbedChatConfig } from '../chat/config';
import { connectToHost, type HostBridge, holdHandshake } from '../chat/host-bridge';
import { createChatStore } from '../chat/store';
import { switchLocale } from '../chat/switch-locale';
import { ChatProvider, type Frame, FrameContext } from '../react/context';
import { checkConfig } from '../react/root';
import { type ToolRenderers, ToolRenderersProvider } from '../react/tool-results';

// From the moment this module loads: the loader sends its handshake once, when the iframe has
// loaded, which can come before the page hydrates and EmbedRoot connects.
holdHandshake();

/** One connection to the loader per page, kept across remounts (React's Strict Mode runs effects twice). */
let bridge: HostBridge | undefined;

export interface EmbedRootProps {
  /** From `getEmbedConfig()` in the page's Server Component. */
  readonly config: EmbedChatConfig;
  /** Your components for tools' results, by tool name, as on `Root` (ADR-0017). */
  readonly toolRenderers?: ToolRenderers | undefined;
  readonly children?: ReactNode;
}

const withLang = (locale: string): URL => {
  const url = new URL(location.href);
  url.searchParams.set('lang', locale);
  return url;
};

/**
 * `Root` for your own page in the widget's iframe (ADR-0018): the page at a bot's `embedPath`.
 * It connects to the loader on the embedding site exactly as askdare's own iframe does: the
 * visitor's identity, `askdare('configure')`, the events for `askdare('on')`, hiding and closing
 * the panel, and language switches. Put `DefaultChat`, an ejected copy of it or your own markup
 * inside; `DefaultChat` then owns the document and shows a close button.
 */
export function EmbedRoot({ config, toolRenderers, children }: EmbedRootProps): ReactElement {
  checkConfig(config);
  const [store] = useState(() => createChatStore(config));
  const [close, setClose] = useState<(() => void) | undefined>(undefined);
  const inline = config.mode === 'inline';

  useEffect(() => {
    bridge ??= connectToHost(config.allowedOrigins, { hello: true });
    const connection = bridge;
    // Starts the chat once the loader has handed over the visitor's identity.
    const unbind = bindBridge(store, connection);
    const stopLocale = switchLocale(store, connection, {
      // The answer under way ends first, so the page hears it as stopped; the chat restores the
      // conversation after the reload, and the loader connects again.
      reload(locale) {
        unbind();
        location.replace(withLang(locale));
      },
      switched(locale, language) {
        document.documentElement.lang = language;
        // A reload, by the visitor or after an error, keeps the new language.
        history.replaceState(history.state, '', withLang(locale));
      },
    });
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
  }, [store, config.allowedOrigins, inline]);

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
