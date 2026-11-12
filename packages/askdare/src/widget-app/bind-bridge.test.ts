import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../chat/events';
import type { PageOptions } from '../chat/page-options';
import { createChatStore } from '../chat/store';
import { echo, fakeServer, testClient, testConfig } from '../chat/testing/fake-server';
import { bindBridge } from './bind-bridge';
import type { HostBridge } from './host-bridge';

beforeEach(() => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A loader that connects when told to, with an identity already set by the page. */
function fakeBridge(identity: string | null) {
  const configure = new Set<(options: PageOptions) => void>();
  const hidden = new Set<() => void>();
  const identify = new Set<(token: string | null) => void>();
  let connect = (): void => {};
  const emitted: ChatEvent[] = [];
  const bridge: HostBridge = {
    embedded: true,
    close: () => {},
    emit: (event) => emitted.push(event),
    onHidden: (listener) => {
      hidden.add(listener);
      return () => hidden.delete(listener);
    },
    onConfigure: (listener) => {
      configure.add(listener);
      return () => configure.delete(listener);
    },
    handshake: new Promise<void>((resolve) => {
      connect = resolve;
    }),
    onIdentify: (listener) => {
      identify.add(listener);
      listener(identity);
      return () => identify.delete(listener);
    },
    onLocale: () => () => {},
  };
  return {
    bridge,
    emitted,
    connect: () => connect(),
    configure: (options: PageOptions) => {
      for (const listener of configure) listener(options);
    },
    hide: () => {
      for (const listener of hidden) listener();
    },
    listeners: () => configure.size + hidden.size + identify.size,
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('bindBridge', () => {
  it("signs in with the page's identity before the first request", async () => {
    const server = fakeServer({ identityKey: () => 'user' });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const host = fakeBridge('a.b.c');
    bindBridge(store, host.bridge);
    await settled();
    expect(server.requests).toEqual([]);
    expect(store.getSnapshot().phase).toBe('starting');

    host.connect();
    for (let attempt = 0; attempt < 50 && store.getSnapshot().phase !== 'ready'; attempt += 1) {
      await settled();
    }
    expect(store.getSnapshot().phase).toBe('ready');
    expect(server.requests[0]?.body['identityToken']).toBe('a.b.c');
  });

  it("passes the chat's events on to the page until unbound", async () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const host = fakeBridge(null);
    const unbind = bindBridge(store, host.bridge);
    host.connect();
    for (let attempt = 0; attempt < 50 && store.getSnapshot().phase !== 'ready'; attempt += 1) {
      await settled();
    }
    expect(host.emitted).toEqual([{ type: 'ready', bot: 'support' }]);
    unbind();
    await store.actions.newConversation();
    expect(host.emitted).toHaveLength(1);
  });

  it('tells the page how an answer under way ended when unbound', async () => {
    const server = fakeServer({ holdAnswer: true, answer: (text) => echo(text).slice(0, 3) });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const host = fakeBridge(null);
    const unbind = bindBridge(store, host.bridge);
    host.connect();
    for (let attempt = 0; attempt < 50 && store.getSnapshot().phase !== 'ready'; attempt += 1) {
      await settled();
    }
    void store.actions.send('Hello');
    for (let attempt = 0; attempt < 50 && !store.getSnapshot().busy; attempt += 1) {
      await settled();
    }
    unbind();
    expect(host.emitted.at(-1)).toMatchObject({ type: 'message.received', outcome: 'stopped' });
  });

  it('passes the page options on and stops when unbound', () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const host = fakeBridge(null);
    const unbind = bindBridge(store, host.bridge);
    host.configure({ greeting: 'Hello from the pricing page' });
    expect(store.getSnapshot().page).toEqual({ greeting: 'Hello from the pricing page' });

    const hide = vi.spyOn(store, 'hide');
    host.hide();
    expect(hide).toHaveBeenCalledOnce();

    unbind();
    expect(host.listeners()).toBe(0);
  });
});
