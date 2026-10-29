/** Messages exchanged with the loader over a dedicated MessagePort. Versioned; unknown ones are ignored. */
export type HostMessage =
  | { readonly v: 1; readonly type: 'chatdock:init' }
  | { readonly v: 1; readonly type: 'ready' }
  | { readonly v: 1; readonly type: 'close' };

export interface HostBridge {
  /** False when the app is opened directly instead of inside the loader's iframe. */
  readonly embedded: boolean;
  /** Asks the host page to close the panel. */
  close(): void;
}

/**
 * Accepts the loader's handshake only from the parent window and an allowed origin, then talks
 * exclusively over the transferred port (ADR-0005). Messages from anywhere else are ignored.
 */
export function connectToHost(allowedOrigins: readonly string[]): HostBridge {
  const embedded = window.parent !== window;
  let port: MessagePort | undefined;
  const allowed = new Set([window.location.origin, ...allowedOrigins]);

  const onMessage = (event: MessageEvent): void => {
    if (port || event.source !== window.parent || !allowed.has(event.origin)) return;
    const data = event.data as Partial<HostMessage> | null;
    if (data?.v !== 1 || data.type !== 'chatdock:init' || !event.ports[0]) return;
    port = event.ports[0];
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
  };
}
