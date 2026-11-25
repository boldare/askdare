// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, testConfig } from '../chat/testing/fake-server';
import type { HistoryMessage, HistoryResponse } from '../protocol/history';
import { LoadEarlier, Message, MessageList, Messages, MessageText, Root } from './headless';
import { DefaultPanel } from './skin';

const message = (id: string, role: 'user' | 'assistant' = 'user'): HistoryMessage => ({
  id,
  role,
  text: `Text of ${id}`,
  citations: [],
  attachments: 0,
});
/** Three pages: the latest, the one before (`c1`) and the oldest (`c2`). */
const PAGES: Readonly<Record<string, HistoryResponse>> = {
  latest: { messages: [message('m5'), message('m6', 'assistant')], before: 'c1' },
  c1: { messages: [message('m3'), message('m4', 'assistant')], before: 'c2' },
  c2: { messages: [message('m1'), message('m2', 'assistant')] },
};

/** An IntersectionObserver the test drives: `show(true)` scrolls the button into view. */
function fakeObserver() {
  const callbacks = new Set<(entries: { isIntersecting: boolean }[]) => void>();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly #callback: (entries: { isIntersecting: boolean }[]) => void;
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        this.#callback = callback;
      }
      observe(): void {
        callbacks.add(this.#callback);
      }
      disconnect(): void {
        callbacks.delete(this.#callback);
      }
    },
  );
  return {
    show: (isIntersecting: boolean) =>
      act(() => {
        for (const callback of callbacks) callback([{ isIntersecting }]);
      }),
  };
}

const page = (before: string | undefined): HistoryResponse =>
  PAGES[before ?? 'latest'] ?? { messages: [] };

function chat(historyPage: (before: string | undefined) => unknown = page) {
  localStorage.setItem('askdare:support:resume', 'resume-1');
  const server = fakeServer({
    historyPage: historyPage as (before: string | undefined) => HistoryResponse,
  });
  vi.stubGlobal('fetch', server.fetch);
  return server;
}

const texts = (): string[] =>
  [...document.querySelectorAll('[data-ask-part="bubble"]')].map((node) => node.textContent ?? '');
const announcement = (): string =>
  document.querySelector('[data-ask-part="announcement"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoadEarlier', () => {
  it('loads older pages above, announces them, and goes at the start', async () => {
    chat();
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    const button = await screen.findByRole('button', { name: 'Show earlier messages' });
    expect(button.getAttribute('data-ask-part')).toBe('load-earlier');
    expect(texts()).toEqual(['Text of m5', 'Text of m6']);
    // At the top of the conversation, above the oldest message.
    expect(button.parentElement?.getAttribute('role')).toBe('log');
    expect(button.nextElementSibling?.getAttribute('data-ask-part')).toBe('message');

    fireEvent.click(button);
    await waitFor(() => expect(texts()).toHaveLength(4));
    expect(texts()[0]).toBe('Text of m3');
    expect(announcement()).toBe('Earlier messages loaded.');

    fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }));
    await waitFor(() => expect(texts()).toHaveLength(6));
    expect(texts()[0]).toBe('Text of m1');
    expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull();
    expect(announcement()).toBe('Earlier messages loaded.');
  });

  it('keeps focus while a page loads, and gives it to the oldest message at the start', async () => {
    let release = (): void => {};
    chat(async (before) => {
      if (before === 'c1')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return page(before);
    });
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    const button = await screen.findByRole('button', { name: 'Show earlier messages' });
    button.focus();
    fireEvent.click(button);
    // The same button, still focusable, says what it does now.
    await waitFor(() => expect(button.textContent).toBe('Loading earlier messages…'));
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('data-loading')).toBe(true);
    expect(announcement()).toBe('');
    expect(document.activeElement).toBe(button);
    release();
    await waitFor(() => expect(texts()).toHaveLength(4));
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toBe('Show earlier messages');

    fireEvent.click(button);
    await waitFor(() => expect(texts()).toHaveLength(6));
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Text of m1'));
    expect(document.activeElement?.getAttribute('data-ask-part')).toBe('message');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });

  it('loads when the visitor scrolls up to it, but not on the first look', async () => {
    const view = fakeObserver();
    const server = chat();
    render(
      <Root config={testConfig()}>
        <DefaultPanel />
      </Root>,
    );
    await screen.findByRole('button', { name: 'Show earlier messages' });
    const pages = () => server.requests.filter((request) => request.path === '/history').length;
    // A conversation short enough to show the button at once doesn't page on its own.
    view.show(true);
    view.show(false);
    expect(pages()).toBe(1);
    view.show(true);
    await waitFor(() => expect(texts()).toHaveLength(4));
    expect(pages()).toBe(2);
  });

  it('keeps what the visitor reads in place when older messages go in above', async () => {
    chat();
    render(
      <Root config={testConfig()}>
        <Messages>
          <LoadEarlier />
          <MessageList>
            <Message>
              <MessageText />
            </Message>
          </MessageList>
        </Messages>
      </Root>,
    );
    const button = await screen.findByRole('button', { name: 'Show earlier messages' });
    const log = screen.getByRole('log');
    // No layout in the test: each message is 100 px high.
    Object.defineProperty(log, 'scrollHeight', {
      get: () => 100 * log.querySelectorAll('[data-ask-part="message"]').length,
    });
    log.scrollTop = 30;
    fireEvent.click(button);
    await waitFor(() => expect(texts()).toHaveLength(4));
    // 170 px from the bottom before, and after.
    expect(log.scrollTop).toBe(230);
  });

  it('takes its own label, props and click handler, and renders nothing at first', async () => {
    const server = chat();
    const clicked = vi.fn();
    const { container } = render(
      <Root config={testConfig()}>
        <Messages>
          <LoadEarlier className="older" onClick={clicked}>
            Older
          </LoadEarlier>
        </Messages>
      </Root>,
    );
    expect(container.querySelector('[data-ask-part="load-earlier"]')).toBeNull();
    const button = await screen.findByRole('button', { name: 'Older' });
    expect(button.className).toBe('older');
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalledOnce();
    // Your handler runs, and the page still loads.
    await waitFor(() =>
      expect(server.requests.filter((request) => request.path === '/history')).toHaveLength(2),
    );
  });
});
