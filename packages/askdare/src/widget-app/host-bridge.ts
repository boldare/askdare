import { identityToken, type PageOptions, pageOptions } from '../chat/page-options';

/** Messages exchanged with the loader over a dedicated MessagePort. Versioned; unknown ones are ignored. */
export type HostMessage =
  /** `identity`: the latest askdare('identify') before the chat connected. */
  | { readonly v: 1; readonly type: 'askdare:init'; readonly identity?: string | null }
  | { readonly v: 1; readonly type: 'identify'; readonly token: string | null }
  | { readonly v: 1; readonly type: 'ready' }
  | { readonly v: 1; readonly type: 'close' }
  | { readonly v: 1; readonly type: 'hidden' }
  | ({ readonly v: 1; readonly type: 'configure' } & PageOptions);

/** How long to wait for the loader before the first request, when it never says hello. */
const HANDSHAKE_TIMEOUT_MS = 3_000;

export interface HostBridge {
  /** False when the app is opened directly instead of inside the loader's iframe. */
  readonly embedded: boolean;
  /** Asks the host page to close the panel. */
  close(): void;
  /** Called when the host page hides the panel; returns an unsubscribe function. */
  onHidden(listener: () => void): () => void;
  /** Called with each askdare('configure') from the host page; returns an unsubscribe function. */
  onConfigure(listener: (options: PageOptions) => void): () => void;
  /**
   * Settles once the loader has connected (or after a few seconds without it): by then the
   * page's first askdare('identify') has arrived, so the first request can carry it.
   */
  readonly handshake: Promise<void>;
  /** Called with each askdare('identify') (a token, or null to sign out); replays the latest. */
  onIdentify(listener: (token: string | null) => void): () => void;
}

/**
 * Accepts the loader's handshake only from the parent window and an allowed origin, then talks
 * exclusively over the transferred port (ADR-0005). Messages from anywhere else are ignored.
 */
export function connectToHost(allowedOrigins: readonly string[]): HostBridge {
  const embedded = window.parent !== window;
  let port: MessagePort | undefined;
  const hiddenListeners = new Set<() => void>();
  const configureListeners = new Set<(options: PageOptions) => void>();
  let latest: PageOptions | undefined;
  const identifyListeners = new Set<(token: string | null) => void>();
  let identity: string | null | undefined;
  const setIdentity = (token: string | null | undefined): void => {
    if (token === undefined) return;
    identity = token;
    for (const listener of identifyListeners) listener(token);
  };
  let connected: () => void = () => {};
  const handshake = new Promise<void>((resolve) => {
    connected = resolve;
    if (embedded) setTimeout(resolve, HANDSHAKE_TIMEOUT_MS);
    else resolve();
  });
  const allowed = new Set([window.location.origin, ...allowedOrigins]);

  const onMessage = (event: MessageEvent): void => {
    if (port || event.source !== window.parent || !allowed.has(event.origin)) return;
    const data = event.data as Partial<HostMessage> | null;
    if (data?.v !== 1 || data.type !== 'askdare:init' || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = (portEvent: MessageEvent<Record<string, unknown> | null>) => {
      if (portEvent.data?.['v'] !== 1) return;
      if (portEvent.data['type'] === 'hidden') {
        for (const listener of hiddenListeners) listener();
      } else if (portEvent.data['type'] === 'configure') {
        latest = pageOptions(portEvent.data);
        for (const listener of configureListeners) listener(latest);
      } else if (portEvent.data['type'] === 'identify') {
        setIdentity(identityToken(portEvent.data['token']));
      }
    };
    port.start();
    port.postMessage({ v: 1, type: 'ready' } satisfies HostMessage);
    window.removeEventListener('message', onMessage);
    setIdentity(identityToken((data as { identity?: unknown }).identity));
    connected();
  };
  if (embedded) window.addEventListener('message', onMessage);

  return {
    embedded,
    close() {
      port?.postMessage({ v: 1, type: 'close' } satisfies HostMessage);
    },
    onHidden(listener) {
      hiddenListeners.add(listener);
      return () => hiddenListeners.delete(listener);
    },
    onConfigure(listener) {
      configureListeners.add(listener);
      if (latest) listener(latest);
      return () => configureListeners.delete(listener);
    },
    handshake,
    onIdentify(listener) {
      identifyListeners.add(listener);
      if (identity !== undefined) listener(identity);
      return () => identifyListeners.delete(listener);
    },
  };
}
