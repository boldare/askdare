// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactElement, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbedChatConfig } from '../chat/config';
import { echo, fakeServer, testConfig } from '../chat/testing/fake-server';
import type { ToolRendererProps } from '../react/tool-results';

const LOADER = 'https://www.example.com';

const config = (change: Partial<EmbedChatConfig> = {}): EmbedChatConfig => ({
  ...testConfig(),
  allowedOrigins: [LOADER],
  mode: 'floating',
  ...change,
});

/** A fresh copy of the entry, so each test gets its own bridge and its own held handshake. */
async function load() {
  vi.resetModules();
  const [{ EmbedRoot }, { DefaultChat }] = await Promise.all([
    import('./index'),
    import('../react/index'),
  ]);
  return { EmbedRoot, DefaultChat };
}

/** The page inside the loader's iframe: `window.parent` is the embedding site's window. */
function framed() {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  const channel = new MessageChannel();
  const received: Record<string, unknown>[] = [];
  channel.port1.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
    received.push(event.data);
  };
  return {
    received,
    /** The loader's hello, as it sends it once the iframe has loaded. */
    init(origin = LOADER, identity?: string | null) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { v: 1, type: 'askdare:init', ...(identity === undefined ? {} : { identity }) },
          origin,
          source: parent as unknown as MessageEventSource,
          ports: [channel.port2],
        }),
      );
    },
    send(message: Record<string, unknown>) {
      channel.port1.postMessage({ v: 1, ...message });
    },
  };
}

function Slots({ data }: ToolRendererProps): ReactElement {
  return <p>Slots: {(data as { slots: string[] }).slots.join(', ')}</p>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EmbedRoot', () => {
  it('works opened directly: the chat owns the document, with no close button', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    const { EmbedRoot, DefaultChat } = await load();
    const { container } = render(
      <EmbedRoot config={config()}>
        <DefaultChat />
      </EmbedRoot>,
    );
    expect(container.querySelector('[data-askdare-embed]')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Brightloop assistant' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close chat' })).toBeNull();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Hello' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('You said: Hello');
  });

  it('joins the loader: identity, configure, events and the close button', async () => {
    const server = fakeServer({ identityKey: (token) => `key-${token.length}` });
    vi.stubGlobal('fetch', server.fetch);
    const loader = framed();
    const { EmbedRoot, DefaultChat } = await load();
    render(
      <EmbedRoot config={config()}>
        <DefaultChat />
      </EmbedRoot>,
    );
    const token = 'eyJ.e30.sig';
    act(() => loader.init(LOADER, token));
    await waitFor(() => expect(loader.received).toContainEqual({ v: 1, type: 'ready' }));
    // The first request waited for the handshake, so it carries the visitor's identity.
    await waitFor(() =>
      expect(server.requests.find((request) => request.path === '/session')?.body).toMatchObject({
        identityToken: token,
      }),
    );

    act(() => loader.send({ type: 'configure', greeting: 'Hello from the shop' }));
    await screen.findByText('Hello from the shop');

    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Hi' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('You said: Hi');
    await waitFor(() =>
      expect(
        loader.received.some(
          (message) =>
            message['type'] === 'event' &&
            (message['event'] as { type: string }).type === 'message.sent',
        ),
      ).toBe(true),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Close chat' }));
    await waitFor(() => expect(loader.received).toContainEqual({ v: 1, type: 'close' }));
  });

  it('keeps a handshake that came before the page hydrated, and connects once in Strict Mode', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const loader = framed();
    const { EmbedRoot, DefaultChat } = await load();
    // Its own origin: bridges of the tests above still listen on this window for newer handshakes.
    const origin = 'https://strict.example';
    // The iframe's load event fired before React rendered anything.
    loader.init(origin);
    render(
      <StrictMode>
        <EmbedRoot config={config({ allowedOrigins: [origin] })}>
          <DefaultChat />
        </EmbedRoot>
      </StrictMode>,
    );
    await waitFor(() => expect(loader.received).toContainEqual({ v: 1, type: 'ready' }));
    expect(loader.received.filter((message) => message['type'] === 'ready')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Close chat' })).toBeTruthy();
  });

  it('ignores a handshake from an origin outside the allowlist', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const loader = framed();
    const { EmbedRoot, DefaultChat } = await load();
    render(
      <EmbedRoot config={config()}>
        <DefaultChat />
      </EmbedRoot>,
    );
    act(() => loader.init('https://evil.example'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // No port was taken, so nothing reaches that page: not even `ready`.
    expect(loader.received).toEqual([]);
  });

  it('shows no close button inline, and draws tool cards with toolRenderers', async () => {
    const card = { callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } };
    const server = fakeServer({
      answer: (text) => [
        ...echo(text).slice(0, 2),
        { type: 'tool.ui', messageId: 'msg_1', ...card },
        ...echo(text).slice(2),
      ],
    });
    vi.stubGlobal('fetch', server.fetch);
    const loader = framed();
    const { EmbedRoot, DefaultChat } = await load();
    render(
      <EmbedRoot config={config({ mode: 'inline' })} toolRenderers={{ find_slots: Slots }}>
        <DefaultChat />
      </EmbedRoot>,
    );
    act(() => loader.init());
    await waitFor(() => expect(loader.received).toContainEqual({ v: 1, type: 'ready' }));
    expect(screen.queryByRole('button', { name: 'Close chat' })).toBeNull();
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Book' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText('Slots: 9:00')).toBeTruthy();
  });

  it("follows the page's language in place, and keeps it in the URL for a reload", async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    const loader = framed();
    const origin = 'https://lang.example';
    const { EmbedRoot, DefaultChat } = await load();
    render(
      <EmbedRoot config={config({ allowedOrigins: [origin] })}>
        <DefaultChat />
      </EmbedRoot>,
    );
    act(() => loader.init(origin));
    await waitFor(() => expect(loader.received).toContainEqual({ v: 1, type: 'ready' }));
    act(() => loader.send({ type: 'locale', locale: 'pl', inPlace: 1 }));
    await waitFor(() => expect(document.documentElement.lang).toBe('pl'));
    expect(new URL(location.href).searchParams.get('lang')).toBe('pl');
    expect(await screen.findByText('Greeting in pl')).toBeTruthy();
  });

  it('keeps what the visitor typed before the page hydrated', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    const { EmbedRoot, DefaultChat } = await load();
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    const page = (
      <EmbedRoot config={config()}>
        <DefaultChat />
      </EmbedRoot>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(page);
    document.body.append(container);
    const field = container.querySelector('textarea') as HTMLTextAreaElement;
    field.value = 'Typed early';
    await act(async () => {
      hydrateRoot(container, page);
    });
    await waitFor(() =>
      expect(
        (container.querySelector('[data-ask-part="send"]') as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(field.value).toBe('Typed early');
    container.remove();
  });

  it('refuses a config that points anywhere but its own route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { EmbedRoot } = await load();
    expect(() => render(<EmbedRoot config={config({ basePath: '//evil.example' })} />)).toThrow(
      /basePath must be a path on this app/,
    );
  });
});
