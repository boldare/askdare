/** Messages exchanged with the loader over a dedicated MessagePort. Versioned; unknown ones are ignored. */
export type HostMessage =
  | { readonly v: 1; readonly type: 'chatdock:init' }
  | { readonly v: 1; readonly type: 'ready' }
  | { readonly v: 1; readonly type: 'close' }
  | { readonly v: 1; readonly type: 'hidden' }
  | ({ readonly v: 1; readonly type: 'configure' } & PageOptions);

/** What the host page may set with chatdock('configure'), checked again here. */
export interface PageOptions {
  readonly greeting?: string;
  readonly starters?: readonly string[];
  readonly context?: string;
}

const MAX_CONTEXT = 1_000;

function pageOptions(data: Record<string, unknown>): PageOptions {
  const greeting = typeof data['greeting'] === 'string' ? data['greeting'].trim() : '';
  const starters = Array.isArray(data['starters'])
    ? data['starters']
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 80)
        .slice(0, 4)
    : undefined;
  const context = typeof data['context'] === 'string' ? data['context'].trim() : '';
  return {
    ...(greeting && greeting.length <= 500 ? { greeting } : {}),
    ...(starters ? { starters } : {}),
    ...(context ? { context: context.slice(0, MAX_CONTEXT) } : {}),
  };
}

export interface HostBridge {
  /** False when the app is opened directly instead of inside the loader's iframe. */
  readonly embedded: boolean;
  /** Asks the host page to close the panel. */
  close(): void;
  /** Called when the host page hides the panel; returns an unsubscribe function. */
  onHidden(listener: () => void): () => void;
  /** Called with each chatdock('configure') from the host page; returns an unsubscribe function. */
  onConfigure(listener: (options: PageOptions) => void): () => void;
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
  const allowed = new Set([window.location.origin, ...allowedOrigins]);

  const onMessage = (event: MessageEvent): void => {
    if (port || event.source !== window.parent || !allowed.has(event.origin)) return;
    const data = event.data as Partial<HostMessage> | null;
    if (data?.v !== 1 || data.type !== 'chatdock:init' || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = (portEvent: MessageEvent<Record<string, unknown> | null>) => {
      if (portEvent.data?.['v'] !== 1) return;
      if (portEvent.data['type'] === 'hidden') {
        for (const listener of hiddenListeners) listener();
      } else if (portEvent.data['type'] === 'configure') {
        latest = pageOptions(portEvent.data);
        for (const listener of configureListeners) listener(latest);
      }
    };
    port.start();
    port.postMessage({ v: 1, type: 'ready' } satisfies HostMessage);
    window.removeEventListener('message', onMessage);
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
  };
}
