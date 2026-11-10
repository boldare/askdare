import { type ReactElement, useEffect, useMemo } from 'react';
import type { ChatStore } from '../chat/store';
import { ChatProvider } from '../react/context';
import { DefaultPanel } from '../react/skin';
import type { HostBridge } from './host-bridge';

export interface AppProps {
  readonly store: ChatStore;
  readonly bridge: HostBridge;
  /** Inside an element of the host page (data-mode="inline"): no close button. */
  readonly inline?: boolean;
}

/** The chat in its iframe: the default look as the document's main landmark (ADR-0011). */
export function App({ store, bridge, inline = false }: AppProps): ReactElement {
  // A floating chat was just opened by the visitor; an inline one only loaded with the page.
  useEffect(() => {
    if (!inline) store.actions.focus();
  }, [inline, store]);
  const onClose = useMemo(
    () =>
      bridge.embedded && !inline
        ? () => {
            store.hide();
            bridge.close();
          }
        : undefined,
    [bridge, inline, store],
  );
  return (
    <ChatProvider store={store}>
      <DefaultPanel headingLevel={1} onClose={onClose} ownsDocument />
    </ChatProvider>
  );
}
