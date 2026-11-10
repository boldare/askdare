// @vitest-environment happy-dom
import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Chat from '../../dist/react.js';
import entrySource from '../../dist/react.js?raw';
import markedSource from '../../dist/react-marked.js?raw';
import { fakeServer, testConfig } from '../chat/testing/fake-server';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const config = {
  ...testConfig(),
  styles: {
    theme: '/api/chat/theme/support.css?scope=inline&v=1',
    skin: '/api/chat/assets/skin.1.css',
    fonts: '/api/chat/assets/fonts.1.css',
  },
};

function Page() {
  return (
    <Chat.Root config={config}>
      <Chat.DefaultChat className="chat" />
    </Chat.Root>
  );
}

describe('dist/react.js', () => {
  it("starts with 'use client', in every chunk", () => {
    expect(entrySource.startsWith("'use client';")).toBe(true);
    expect(markedSource.startsWith("'use client';")).toBe(true);
  });

  it('never sets HTML', () => {
    expect(entrySource).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  });

  it('renders the theme root with its stylesheets on the server', () => {
    const html = renderToString(<Page />);
    expect(html).toContain('data-askdare-root=""');
    expect(html).toContain('data-ask-preset="aura"');
    expect(html).toContain('data-ask-bot="support"');
    expect(html).toContain('data-ask-scheme="auto"');
    for (const href of Object.values(config.styles)) {
      expect(html).toContain(`href="${href.replace('&', '&amp;')}"`);
    }
    expect(html).toContain('data-precedence="askdare"');
  });

  it('hydrates the server HTML without mismatches, even with a stored conversation', async () => {
    const html = renderToString(<Page />);
    // The browser has a conversation the server knew nothing about.
    localStorage.setItem('askdare:support:resume', 'resume-1');
    const server = fakeServer({
      history: [{ id: 'm1', role: 'assistant', text: 'Earlier', citations: [], attachments: 0 }],
    });
    vi.stubGlobal('fetch', server.fetch);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable: unknown[] = [];
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    await act(async () => {
      hydrateRoot(container, <Page />, { onRecoverableError: (error) => recoverable.push(error) });
    });
    await vi.waitFor(() => expect(container.textContent).toContain('Earlier'));
    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    container.remove();
  });
});
