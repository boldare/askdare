import type { ChatStore } from '../chat/store';
import type { HostBridge } from './host-bridge';

/**
 * Connects the iframe's chat store to the loader on the host page: per-page greeting, starters
 * and context, the page's identity, hiding the panel, and the chat's events for the page's
 * listeners. Returns a function that disconnects it.
 */
export function bindBridge(store: ChatStore, bridge: HostBridge): () => void {
  let active = true;
  let stopIdentify = (): void => {};
  const stopConfigure = bridge.onConfigure((page) => store.configure(page));
  const stopHidden = bridge.onHidden(() => store.hide());
  const stopEvents = store.onEvent((event) => bridge.emit(event));
  // The page signs the visitor in and out with askdare('identify') (ADR-0009). The first request
  // waits for the loader, so it already carries the identity of a signed-in visitor.
  store.start({
    handshake: bridge.handshake.then(() => {
      if (active) stopIdentify = bridge.onIdentify((token) => store.identify(token));
    }),
  });
  return () => {
    active = false;
    stopConfigure();
    stopHidden();
    stopIdentify();
    // Stopped first, so the page still hears how an answer under way ended.
    store.stop();
    stopEvents();
  };
}
