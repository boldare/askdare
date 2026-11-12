// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { LOADER_JS } from '../generated/assets';
import { loaderWithLook } from '../server/launcher';

const APP = 'https://app.test';
const auto = defineBot({
  id: 'support',
  model: 'm',
  instructions: 'x',
  widget: { locale: 'auto' },
});
const fixed = defineBot({ id: 'support', model: 'm', instructions: 'x', widget: { locale: 'en' } });

type Api = (command: string, ...args: unknown[]) => unknown;

/** What the loader sent the chat over each port, one list per handshake. */
let handshakes: unknown[][];
/** The loader's end of each handshake's channel. */
let ports: { onmessage: ((event: MessageEvent) => void) | null }[];
const lastPort = (): { onmessage: ((event: MessageEvent) => void) | null } =>
  ports.at(-1) ?? { onmessage: null };
/** URLs the chat's iframe was sent to with location.replace(). */
let reloads: string[];

/** Runs the real built loader on this page, as `<script src=…widget.js?bot=support …>`. */
function load(bot = auto, attributes: Record<string, string> = {}): Api {
  const script = document.createElement('script');
  script.src = `${APP}/api/chat/widget.js?bot=support`;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  new Function(loaderWithLook(LOADER_JS, bot))();
  return window.askdare as unknown as Api;
}

const launcher = (): HTMLElement =>
  document
    .querySelector('[data-askdare]')
    ?.shadowRoot?.querySelector('[part=launcher]') as HTMLElement;

/** The chat's iframe: a stand-in, so happy-dom doesn't try to load its page. */
let frame: HTMLElement & { src?: string };

/** Opens the chat and stands in for its iframe loading, which connects a new port. */
function openChat(api: Api): void {
  api('open');
  frame.dispatchEvent(new Event('load'));
}

beforeEach(() => {
  handshakes = [];
  ports = [];
  reloads = [];
  document.documentElement.lang = 'en';
  // This test's list: a page's observer outlives its test, as the loader never stops on a page.
  const ours = reloads;
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name: string) => {
    if (name !== 'iframe') return create(name);
    frame = create('div');
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage: () => {}, location: { replace: (url: string) => ours.push(url) } },
    });
    return frame;
  });
  // Records what the loader posts over each new channel's port.
  vi.stubGlobal(
    'MessageChannel',
    class {
      readonly port1 = (() => {
        const sent: unknown[] = [];
        handshakes.push(sent);
        const port = { postMessage: (message: unknown) => sent.push(message), onmessage: null };
        ports.push(port);
        return port;
      })();
      readonly port2 = {};
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.askdare;
  document.body.replaceChildren();
});

/** The languages the chat was switched to: asked over its port, or reloaded from the page. */
const switches = (): (string | null)[] => [
  ...handshakes
    .flat()
    .filter((message) => (message as { type: string }).type === 'locale')
    .map((message) => (message as { locale: string }).locale),
  ...reloads.map((url) => new URL(url).searchParams.get('lang')),
];

describe('askdare("configure", { locale }) (ADR-0014)', () => {
  it('switches the launcher and asks the chat to reload in the new language', () => {
    const api = load();
    expect(launcher().getAttribute('aria-label')).toBe('Ask us, Open chat');
    openChat(api);
    expect(frame.src).toBe(`${APP}/api/chat/embed/support?lang=en`);

    api('configure', { locale: 'pl-pl' });
    expect(handshakes.at(-1)?.at(-1)).toEqual({ v: 1, type: 'locale', locale: 'pl-PL' });
    expect(reloads).toEqual([]);
    expect(launcher().getAttribute('aria-label')).toBe('Zamknij czat');
    api('close');
    expect(launcher().getAttribute('aria-label')).toMatch(/, Otwórz czat$/);
  });

  it('reloads a chat that hasn’t connected yet from the page', () => {
    const api = load();
    api('open');
    api('configure', { locale: 'pl' });
    expect(reloads).toEqual([`${APP}/api/chat/embed/support?lang=pl`]);
    // A switch before the reloaded chat connects, too.
    frame.dispatchEvent(new Event('load'));
    api('configure', { locale: 'de' });
    api('configure', { locale: 'en' });
    expect(switches()).toEqual(['de', 'pl', 'en']);
  });

  it('opens a chat that isn’t loaded yet in the new language, without a reload', () => {
    const api = load();
    api('configure', { locale: 'pl' });
    openChat(api);
    expect(frame.src).toBe(`${APP}/api/chat/embed/support?lang=pl`);
    expect(reloads).toEqual([]);
  });

  it('keeps the page options and identity set before, and sends them again', () => {
    const api = load();
    api('configure', { greeting: 'Hello from pricing' });
    api('identify', 'a.b.c');
    openChat(api);
    // A field the page may not set doesn't count as new page options either.
    api('configure', { locale: 'pl', model: 'not-allowed' });
    frame.dispatchEvent(new Event('load'));
    expect(handshakes.at(-1)).toEqual([
      { v: 1, type: 'configure', greeting: 'Hello from pricing' },
    ]);
    // The locale is the loader's: it never reaches the chat as a page option.
    const configures = handshakes
      .flat()
      .filter((message) => JSON.stringify(message).includes('configure'));
    expect(JSON.stringify(configures)).not.toContain('locale');
  });

  it('shows the launcher on phones again until the reloaded chat is up', () => {
    const api = load();
    openChat(api);
    expect(launcher().dataset['ready']).toBeUndefined();
    // The chat says it is up over its port.
    const ready = { data: { v: 1, type: 'ready' } } as MessageEvent;
    lastPort().onmessage?.(ready);
    expect(launcher().dataset['ready']).toBe('');
    api('configure', { locale: 'pl' });
    expect(launcher().dataset['ready']).toBeUndefined();
  });

  it('does nothing for the language the chat already has', () => {
    const api = load();
    openChat(api);
    api('configure', { locale: 'EN' });
    expect(switches()).toEqual([]);
  });

  it('ignores a value that isn’t a language tag, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = load();
    openChat(api);
    api('configure', { locale: 'not a language!' });
    api('configure', { locale: 42 });
    expect(switches()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("isn't a language tag"));
  });

  it('leaves a bot with a fixed locale as it is, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = load(fixed);
    openChat(api);
    api('configure', { locale: 'pl' });
    api('configure', { locale: 'de' });
    expect(switches()).toEqual([]);
    expect(launcher().getAttribute('aria-label')).toBe('Close chat');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"support" has a fixed locale'));
  });
});

describe('data-follow-lang', () => {
  it('follows <html lang>; configure() wins until the next change', async () => {
    const api = load(auto, { 'data-follow-lang': '' });
    openChat(api);
    document.documentElement.lang = 'pl';
    await vi.waitFor(() => expect(switches()).toEqual(['pl']));
    expect(launcher().getAttribute('aria-label')).toBe('Zamknij czat');

    frame.dispatchEvent(new Event('load'));
    api('configure', { locale: 'en' });
    expect(switches()).toEqual(['pl', 'en']);
    // The same lang again isn't a change: the page's explicit choice stays.
    document.documentElement.lang = 'pl';
    document.documentElement.lang = 'de';
    await vi.waitFor(() => expect(switches()).toEqual(['pl', 'en', 'de']));
  });

  it('is off without the attribute', async () => {
    const api = load();
    openChat(api);
    document.documentElement.lang = 'pl';
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(switches()).toEqual([]);
  });
});
