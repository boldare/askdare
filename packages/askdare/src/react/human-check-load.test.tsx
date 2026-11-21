// @vitest-environment happy-dom
// A file of its own: the Turnstile script is loaded once per module, and these tests start with none.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import { Root } from './headless';
import { DefaultPanel } from './skin';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function send(text: string): Promise<void> {
  const field = screen.getByRole('textbox');
  fireEvent.change(field, { target: { value: text } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.keyDown(field, { key: 'Enter' });
}

/** Scripts the chat appended; kept out of the document, where happy-dom would fail to load them. */
let appended: HTMLScriptElement[] = [];
const script = (): HTMLScriptElement | undefined =>
  appended.find((node) => node.src.startsWith('https://challenges.cloudflare.com/turnstile/'));

describe('loading Turnstile', () => {
  it('tries again after a script that loaded without starting Turnstile', async () => {
    vi.stubGlobal('fetch', fakeServer().fetch);
    appended = [];
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      appended.push(...(nodes as HTMLScriptElement[]));
    });
    render(
      <Root config={testConfig({ humanCheck: { provider: 'turnstile', siteKey: 'key' } })}>
        <DefaultPanel />
      </Root>,
    );
    await send('Hello');
    await waitFor(() => expect(script()).toBeDefined());
    act(() => {
      script()?.dispatchEvent(new Event('load'));
    });
    await screen.findByText('We couldn’t confirm you’re human. Please try again.');
    appended = [];

    // Cloudflare is back: the next check loads the script again and renders the widget.
    const renderWidget = vi.fn(() => 'w1');
    await send('Hello again');
    await waitFor(() => expect(script()).toBeDefined());
    vi.stubGlobal('turnstile', { render: renderWidget, remove: vi.fn() });
    act(() => {
      script()?.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
  });
});
