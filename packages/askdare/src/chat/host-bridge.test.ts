// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const LOADER = 'https://www.example.com';

/** A fresh module, so each test starts with no held handshake. */
async function load() {
  vi.resetModules();
  return import('./host-bridge');
}

function parentWindow() {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  return parent;
}

function hello(source: unknown, origin = LOADER) {
  const channel = new MessageChannel();
  const received: unknown[] = [];
  channel.port1.onmessage = (event) => received.push(event.data);
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { v: 1, type: 'askdare:init', identity: 'eyJ.e30.sig' },
      origin,
      source: source as MessageEventSource,
      ports: [channel.port2],
    }),
  );
  return received;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe('the bridge to the loader', () => {
  it('takes a handshake held from before it connected, with its identity', async () => {
    const parent = parentWindow();
    const { connectToHost, holdHandshake } = await load();
    holdHandshake();
    const received = hello(parent);
    const bridge = connectToHost([LOADER]);
    const identities: (string | null)[] = [];
    bridge.onIdentify((token) => identities.push(token));
    await bridge.handshake;
    await settled();
    expect(received).toEqual([{ v: 1, type: 'ready' }]);
    expect(identities).toEqual(['eyJ.e30.sig']);
  });

  it('checks a held handshake like any other: its window and its origin', async () => {
    const parent = parentWindow();
    const { connectToHost, holdHandshake } = await load();
    holdHandshake();
    const fromElsewhere = hello({ postMessage() {} });
    const fromForeignOrigin = hello(parent, 'https://evil.example');
    connectToHost([LOADER]);
    await settled();
    expect(fromElsewhere).toEqual([]);
    expect(fromForeignOrigin).toEqual([]);
  });

  it('holds nothing outside an iframe', async () => {
    const { connectToHost, holdHandshake } = await load();
    holdHandshake();
    // Its own origin: bridges of the tests above still listen on this window.
    const other = 'https://other.example';
    const received = hello(window, other);
    const bridge = connectToHost([other]);
    expect(bridge.embedded).toBe(false);
    await settled();
    expect(received).toEqual([]);
  });
});

describe('asking the loader for the handshake (ADR-0018)', () => {
  it('says hello to the allowed origins only when it has no handshake, and takes a newer one', async () => {
    const parent = parentWindow();
    const { connectToHost } = await load();
    const origin = 'https://hello.example';
    const bridge = connectToHost([origin], { hello: true });
    const targets = (parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[1],
    );
    expect(targets.sort()).toEqual([origin, window.location.origin].sort());
    expect((parent.postMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      v: 1,
      type: 'askdare:hello',
    });

    const first = hello(parent, origin);
    await bridge.handshake;
    await settled();
    // The loader answered the hello after its load handshake: the newer port wins.
    const second = hello(parent, origin);
    await settled();
    expect(first).toEqual([{ v: 1, type: 'ready' }]);
    expect(second).toEqual([{ v: 1, type: 'ready' }]);
    bridge.close();
    await settled();
    expect(second).toContainEqual({ v: 1, type: 'close' });
    expect(first).not.toContainEqual({ v: 1, type: 'close' });
  });

  it("keeps askdare's own page to the first handshake, as before", async () => {
    const parent = parentWindow();
    const { connectToHost } = await load();
    const origin = 'https://first.example';
    connectToHost([origin]);
    expect(parent.postMessage).not.toHaveBeenCalled();
    const first = hello(parent, origin);
    await settled();
    const second = hello(parent, origin);
    await settled();
    expect(first).toEqual([{ v: 1, type: 'ready' }]);
    expect(second).toEqual([]);
  });
});
