import type { ChatEvent } from './events';
import { identityToken, type PageOptions, pageLocale, pageOptions } from './page-options';

/** Messages exchanged with the loader over a dedicated MessagePort. Versioned; unknown ones are ignored. */
export type HostMessage =
  /** `identity`: the latest askdare('identify') before the chat connected. */
  | { readonly v: 1; readonly type: 'askdare:init'; readonly identity?: string | null }
  /**
   * Sent to the loader by a chat page that may have missed `askdare:init` because it runs after
   * its load event (ADR-0018); the loader answers with a new `askdare:init`.
   */
  | { readonly v: 1; readonly type: 'askdare:hello' }
  | { readonly v: 1; readonly type: 'identify'; readonly token: string | null }
  | { readonly v: 1; readonly type: 'ready' }
  | { readonly v: 1; readonly type: 'close' }
  | { readonly v: 1; readonly type: 'hidden' }
  /**
   * The page switched the chat's language: a BCP 47 tag (ADR-0014). `inPlace` from a loader that
   * keeps the chat connected (step 2); without it, the chat reloads (step 1).
   */
  | { readonly v: 1; readonly type: 'locale'; readonly locale: string; readonly inPlace?: 1 }
  /** A chat event for the page's askdare('on') listeners (ADR-0013). */
  | { readonly v: 1; readonly type: 'event'; readonly event: ChatEvent }
  | ({ readonly v: 1; readonly type: 'configure' } & PageOptions);

/** Handshakes that arrived before the chat connected, kept by `holdHandshake`. */
const held: MessageEvent[] = [];

/**
 * Keeps the loader's handshake if it arrives before `connectToHost` runs: the loader sends it once,
 * when the iframe has loaded, and a page that hydrates later (the site's own page at `embedPath`,
 * ADR-0018) would miss it. Only messages from the parent window are kept; `connectToHost` checks
 * their origin as it checks any other.
 */
export function holdHandshake(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Partial<HostMessage> | null;
    if (event.source === window.parent && data?.v === 1 && data.type === 'askdare:init') {
      held.push(event);
    }
  });
}

/** How long to wait for the loader before the first request, when it never says hello. */
const HANDSHAKE_TIMEOUT_MS = 3_000;

export interface HostBridge {
  /** False when the app is opened directly instead of inside the loader's iframe. */
  readonly embedded: boolean;
  /** Asks the host page to close the panel. */
  close(): void;
  /** Passes a chat event on to the host page; dropped before the loader connects. */
  emit(event: ChatEvent): void;
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
  /** Called with each language the page switches the chat to; returns an unsubscribe function. */
  onLocale(listener: (locale: string, inPlace: boolean) => void): () => void;
}

/**
 * Accepts the loader's handshake only from the parent window and an allowed origin, then talks
 * exclusively over the transferred port (ADR-0005). Messages from anywhere else are ignored.
 */
export function connectToHost(
  allowedOrigins: readonly string[],
  options: {
    /**
     * Asks the loader for the handshake, and takes the newest one it sends: for a page that may run
     * after its load event, when the loader sent its first (ADR-0018). Off in askdare's own page,
     * whose script always runs first.
     */
    readonly hello?: boolean;
  } = {},
): HostBridge {
  const embedded = window.parent !== window;
  let port: MessagePort | undefined;
  const hiddenListeners = new Set<() => void>();
  const configureListeners = new Set<(options: PageOptions) => void>();
  let latest: PageOptions | undefined;
  const identifyListeners = new Set<(token: string | null) => void>();
  const localeListeners = new Set<(locale: string, inPlace: boolean) => void>();
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
    if ((port && !options.hello) || event.source !== window.parent || !allowed.has(event.origin)) {
      return;
    }
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
      } else if (portEvent.data['type'] === 'locale') {
        const locale = pageLocale(portEvent.data['locale']);
        const inPlace = portEvent.data['inPlace'] === 1;
        if (locale) for (const listener of localeListeners) listener(locale, inPlace);
      }
    };
    port.start();
    port.postMessage({ v: 1, type: 'ready' } satisfies HostMessage);
    // With `hello`, a later handshake from the loader replaces this one, so keep listening.
    if (!options.hello) window.removeEventListener('message', onMessage);
    setIdentity(identityToken((data as { identity?: unknown }).identity));
    connected();
  };
  if (embedded) {
    window.addEventListener('message', onMessage);
    for (const event of held.splice(0)) onMessage(event);
    // Only to the origins that may embed the chat: nothing reaches any other page.
    if (options.hello && !port) {
      for (const origin of allowed) {
        window.parent.postMessage({ v: 1, type: 'askdare:hello' } satisfies HostMessage, origin);
      }
    }
  }

  return {
    embedded,
    close() {
      port?.postMessage({ v: 1, type: 'close' } satisfies HostMessage);
    },
    emit(event) {
      port?.postMessage({ v: 1, type: 'event', event } satisfies HostMessage);
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
    onLocale(listener) {
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
  };
}
