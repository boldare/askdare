// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import { Root } from './headless';
import { DefaultPanel } from './skin';

const SITE_KEY = '1x00000000000000000000AA';

/** Stands in for Cloudflare's script: records each widget and lets the test answer it. */
interface FakeWidget {
  readonly element: HTMLElement;
  readonly options: Record<string, unknown>;
  removed: boolean;
}
let widgets: FakeWidget[];

beforeEach(() => {
  localStorage.clear();
  widgets = [];
  vi.stubGlobal('turnstile', {
    render: (element: HTMLElement, options: Record<string, unknown>) => {
      widgets.push({ element, options, removed: false });
      return String(widgets.length - 1);
    },
    remove: (id: string) => {
      const widget = widgets[Number(id)];
      if (widget) widget.removed = true;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function send(text: string): Promise<void> {
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: text } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.keyDown(field, { key: 'Enter' });
}

const callback = (widget: FakeWidget | undefined, name: string): ((value?: string) => void) =>
  widget?.options[name] as (value?: string) => void;

describe('HumanCheck in the default look', () => {
  it('shows the challenge when the first session starts, then sends with its token', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig({ humanCheck: { provider: 'turnstile', siteKey: SITE_KEY } })}>
        <DefaultPanel />
      </Root>,
    );
    // Nothing to check until a session is needed.
    expect(screen.queryByRole('group', { name: 'Checking that you’re human' })).toBeNull();

    await send('Hello');
    const region = await screen.findByRole('group', { name: 'Checking that you’re human' });
    await waitFor(() => expect(widgets).toHaveLength(1));
    expect(widgets[0]?.element).toBe(region);
    expect(widgets[0]?.options).toMatchObject({ sitekey: SITE_KEY, language: 'en' });
    expect(server.requests.some((request) => request.path === '/session')).toBe(false);

    act(() => callback(widgets[0], 'callback')('token-1'));
    await screen.findByText('You said: Hello');
    expect(server.requests.find((request) => request.path === '/session')?.body).toMatchObject({
      humanToken: 'token-1',
    });
    expect(screen.queryByRole('group', { name: 'Checking that you’re human' })).toBeNull();
    expect(widgets[0]?.removed).toBe(true);
  });

  it('says so when the challenge fails, and asks again on the next message', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig({ humanCheck: { provider: 'turnstile', siteKey: SITE_KEY } })}>
        <DefaultPanel />
      </Root>,
    );
    await send('Hello');
    await waitFor(() => expect(widgets).toHaveLength(1));
    act(() => callback(widgets[0], 'error-callback')());
    await screen.findByText('We couldn’t confirm you’re human. Please try again.');
    expect(server.requests.some((request) => request.path === '/session')).toBe(false);

    await send('Hello again');
    await waitFor(() => expect(widgets).toHaveLength(2));
    act(() => callback(widgets[1], 'callback')('token-2'));
    await screen.findByText('You said: Hello again');
  });

  it('renders nothing and loads no script for a bot without a check', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    await send('Hello');
    await screen.findByText('You said: Hello');
    expect(widgets).toHaveLength(0);
    expect(document.querySelector('[data-ask-part="human-check"]')).toBeNull();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect(server.requests.find((request) => request.path === '/session')?.body).not.toHaveProperty(
      'humanToken',
    );
  });
});
