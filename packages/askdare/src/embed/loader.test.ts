// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBot } from '../bot/define-bot';
import { LOADER_JS } from '../generated/assets';
import { loaderWithLook } from '../server/launcher';
import { defineTheme } from '../theme/theme';

const APP = 'https://app.test';
const auto = createBot({
  id: 'support',
  model: 'm',
  instructions: 'x',
  widget: { locale: 'auto' },
});
const fixed = createBot({ id: 'support', model: 'm', instructions: 'x', widget: { locale: 'en' } });

type Api = (command: string, ...args: unknown[]) => unknown;

/** What the loader sent the chat over each port, one list per handshake. */
let handshakes: unknown[][];
/** The loader's end of each handshake's channel. */
let ports: { onmessage: ((event: MessageEvent) => void) | null }[];
const lastPort = (): { onmessage: ((event: MessageEvent) => void) | null } =>
  ports.at(-1) ?? { onmessage: null };
/** URLs the chat's iframe was sent to with location.replace(). */
let reloads: string[];

/**
 * Runs the real built loader on this page, as `<script src=…widget.js?bot=support …>`, with the look
 * the server inlines for `bot` (null: a `src` without a known bot).
 */
function load(
  bot: typeof auto | null = auto,
  attributes: Record<string, string> = {},
  src = `${APP}/api/chat/widget.js?bot=support`,
): Api {
  const script = document.createElement('script');
  script.src = src;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  new Function(loaderWithLook(LOADER_JS, bot ?? undefined))();
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
  it('switches the launcher and asks the chat to switch in place', () => {
    const api = load();
    expect(launcher().getAttribute('aria-label')).toBe('Ask us, Open chat');
    openChat(api);
    expect(frame.src).toBe(`${APP}/api/chat/embed/support?lang=en`);

    api('configure', { locale: 'pl-pl' });
    expect(handshakes.at(-1)?.at(-1)).toEqual({
      v: 1,
      type: 'locale',
      locale: 'pl-PL',
      inPlace: 1,
    });
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
    // Once connected, every switch goes over the port and the chat stays connected.
    frame.dispatchEvent(new Event('load'));
    api('configure', { locale: 'de' });
    api('configure', { locale: 'en' });
    expect(switches()).toEqual(['de', 'en', 'pl']);
    expect(reloads).toHaveLength(1);
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

  it('keeps a connected chat ready through a switch in place', () => {
    const api = load();
    openChat(api);
    expect(launcher().dataset['ready']).toBeUndefined();
    // The chat says it is up over its port.
    const ready = { data: { v: 1, type: 'ready' } } as MessageEvent;
    lastPort().onmessage?.(ready);
    expect(launcher().dataset['ready']).toBe('');
    api('configure', { locale: 'pl' });
    expect(launcher().dataset['ready']).toBe('');
    expect(reloads).toEqual([]);
  });

  it('shows the launcher on phones again until a chat reloaded from the page is up', () => {
    const api = load();
    api('open');
    api('configure', { locale: 'pl' });
    expect(reloads).toHaveLength(1);
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

describe('a chat page that asks for the handshake (ADR-0018)', () => {
  const hello = (source: unknown, origin = APP) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { v: 1, type: 'askdare:hello' },
        origin,
        source: source as MessageEventSource,
      }),
    );

  it('answers its own iframe on the app with a new handshake, and nobody else', () => {
    openChat(load(fixed));
    expect(handshakes).toHaveLength(1);
    const own = (frame as unknown as { contentWindow: unknown }).contentWindow;
    hello(own, 'https://evil.example');
    hello({ postMessage() {} });
    expect(handshakes).toHaveLength(1);
    hello(own);
    expect(handshakes).toHaveLength(2);
  });
});

describe('the launcher look (ADR-0033)', () => {
  const shadow = (): ShadowRoot =>
    (document.querySelector('[data-askdare]') as HTMLElement).shadowRoot as ShadowRoot;
  const host = (): HTMLElement => document.querySelector('[data-askdare]') as HTMLElement;

  it('gives a tag with only data-bot the default look from the server', () => {
    load(null, { 'data-bot': 'support' }, `${APP}/api/chat/widget.js`);
    expect(launcher().className).toBe('circle');
    expect(launcher().getAttribute('aria-label')).toBe('Open chat');
    expect(host().style.getPropertyValue('--a')).toBe('#1f5fe0');
    expect(host().style.getPropertyValue('--r')).toBe('min(18px, 24px)');
    expect(host().dataset['askdareScheme']).toBe('auto');
    expect(shadow().querySelector('[part=panel]')?.getAttribute('aria-label')).toBe('Chat');
  });

  it("falls back to the default look when data-bot isn't the bot in ?bot=", () => {
    // `auto` has the orb launcher.
    load(auto, { 'data-bot': 'sales' });
    expect(launcher().className).toBe('circle');
    expect(launcher().getAttribute('aria-label')).toBe('Open chat');
  });

  it('builds its icons as SVG nodes, never from HTML (Trusted Types)', () => {
    const innerHTML = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const api = load(
      createBot({
        id: 'support',
        model: 'm',
        instructions: 'x',
        widget: { theme: defineTheme({ variants: { launcher: 'circle' } }) },
      }),
    );
    const svg = (): SVGElement | null => launcher().querySelector('svg');
    expect(svg()?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg()?.getAttribute('aria-hidden')).toBe('true');
    expect(svg()?.getAttribute('width')).toBe('26');
    expect(svg()?.getAttribute('fill')).toBe('currentColor');
    openChat(api);
    expect(svg()?.getAttribute('width')).toBe('22');
    expect(svg()?.getAttribute('stroke')).toBe('currentColor');
    expect(launcher().hasAttribute('data-turned')).toBe(true);
    api('close');
    expect(svg()?.getAttribute('width')).toBe('26');
    expect(launcher().querySelectorAll('svg')).toHaveLength(1);
    expect(innerHTML).not.toHaveBeenCalled();
  });
});

describe('the greeting next to the launcher (ADR-0033)', () => {
  const greeter = createBot({
    id: 'support',
    model: 'm',
    instructions: 'x',
    widget: { locale: 'en', launcherGreeting: { delaySeconds: 3 } },
  });
  const shadow = (): ShadowRoot =>
    (document.querySelector('[data-askdare]') as HTMLElement).shadowRoot as ShadowRoot;
  const greeting = (): HTMLElement | null => shadow().querySelector('[part=greeting]');
  const dismiss = (): HTMLButtonElement =>
    greeting()?.querySelector('[aria-label]') as HTMLButtonElement;
  /** The page's view of the loader's events. */
  const seen = (api: Api): string[] => {
    const types: string[] = [];
    api('on', '*', (event: { type: string }) => types.push(event.type));
    return types;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it('is off for a bot without one', () => {
    load(fixed);
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
  });

  it('shows after its delay, without taking focus or storing anything', () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const api = load(greeter);
    const events = seen(api);
    vi.advanceTimersByTime(2_999);
    expect(greeting()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(greeting()?.textContent).toBe('Hi! I’m an AI assistant. Can I help you?×');
    expect(dismiss().getAttribute('aria-label')).toBe('Dismiss');
    // Not a live region, and just before the launcher in the tab order.
    expect(greeting()?.hasAttribute('role')).toBe(false);
    expect(greeting()?.hasAttribute('aria-live')).toBe(false);
    expect(greeting()?.nextElementSibling).toBe(launcher());
    expect(document.activeElement).toBe(before);
    expect(sessionStorage.length).toBe(0);
    expect(events).toEqual(['greeting.shown']);
  });

  it('× dismisses it, focuses the launcher and keeps it away for the session', () => {
    const api = load(greeter);
    const events = seen(api);
    vi.advanceTimersByTime(3_000);
    dismiss().click();
    expect(greeting()).toBeNull();
    expect(shadow().activeElement).toBe(launcher());
    expect(sessionStorage.getItem('askdare:support:greeted')).toBe('1');
    expect(events).toEqual(['greeting.shown', 'greeting.dismissed']);

    // The next page of the same session.
    delete window.askdare;
    document.body.replaceChildren();
    load(greeter);
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
  });

  it('Escape dismisses it; other keys work as usual', () => {
    load(greeter);
    vi.advanceTimersByTime(3_000);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dismiss().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(greeting()).not.toBeNull();
    dismiss().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(greeting()).toBeNull();
    expect(shadow().activeElement).toBe(launcher());
  });

  it('opens the chat when clicked, and opening keeps it away for the session', () => {
    const api = load(greeter);
    const events = seen(api);
    vi.advanceTimersByTime(3_000);
    (greeting()?.querySelector('button') as HTMLButtonElement | null)?.click();
    expect(greeting()).toBeNull();
    expect(launcher().getAttribute('aria-expanded')).toBe('true');
    expect(sessionStorage.getItem('askdare:support:greeted')).toBe('1');
    expect(events).toEqual(['greeting.shown', 'open']);
  });

  it("doesn't show once the chat was opened on the page", () => {
    const api = load(greeter);
    api('open');
    api('close');
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
    expect(sessionStorage.getItem('askdare:support:greeted')).toBe('1');
  });

  it('is off with data-greeting="off", inline, without our launcher or without storage', () => {
    load(greeter, { 'data-greeting': 'off' });
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
    document.body.replaceChildren();
    delete window.askdare;

    load(greeter, { 'data-launcher': 'none' });
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
    document.body.replaceChildren();
    delete window.askdare;

    // Browsers throw on reading `sessionStorage` when the visitor blocks site data.
    const storage = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    load(greeter);
    vi.advanceTimersByTime(60_000);
    expect(greeting()).toBeNull();
    storage.mockRestore();
    expect(sessionStorage.length).toBe(0);
  });

  it('sets its text as text, never as HTML', () => {
    const innerHTML = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    load(
      createBot({
        id: 'support',
        model: 'm',
        instructions: 'x',
        widget: {
          launcherGreeting: true,
          texts: { 'launcher.greeting': '<img src=x onerror=alert(1)>' },
        },
      }),
    );
    vi.advanceTimersByTime(5_000);
    expect(greeting()?.querySelector('img')).toBeNull();
    expect(greeting()?.querySelector('button')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(innerHTML).not.toHaveBeenCalled();
  });
});

describe('the unread badge (ADR-0033)', () => {
  const answer = (outcome: string): void =>
    lastPort().onmessage?.({
      data: { v: 1, type: 'event', event: { type: 'message.received', outcome, durationMs: 1 } },
    } as MessageEvent);

  it('counts answers that arrive while the chat is closed, and clears when it opens', () => {
    const api = load(fixed);
    openChat(api);
    answer('completed');
    expect(launcher().dataset['unread']).toBeUndefined();
    api('close');
    answer('completed');
    answer('stopped');
    answer('failed');
    expect(launcher().dataset['unread']).toBe('1');
    expect(launcher().getAttribute('aria-label')).toBe('Ask us, Open chat, new messages');
    for (let i = 0; i < 9; i += 1) answer('completed');
    expect(launcher().dataset['unread']).toBe('9+');
    api('open');
    expect(launcher().dataset['unread']).toBeUndefined();
    expect(launcher().getAttribute('aria-label')).toBe('Close chat');
    api('close');
    expect(launcher().getAttribute('aria-label')).toBe('Ask us, Open chat');
  });

  it('keeps the unread text through a language switch', () => {
    const api = load();
    openChat(api);
    api('close');
    answer('completed');
    expect(launcher().getAttribute('aria-label')).toBe('Ask us, Open chat, new messages');
    api('configure', { locale: 'pl' });
    expect(launcher().getAttribute('aria-label')).toBe('Zapytaj nas, Otwórz czat, nowe wiadomości');
  });
});
