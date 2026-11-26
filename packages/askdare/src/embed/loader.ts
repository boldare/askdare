/**
 * askdare loader: the only code that runs on the host page. It draws a launcher inside a shadow
 * root, creates the chat iframe on first open and talks to it over a MessagePort (ADR-0005).
 * Usage: <script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
 * (`data-bot="support"` on the tag works too; `?bot=` also brings the bot's launcher look.)
 */

import { eventListeners } from '../chat/events';
import { pageLocale } from '../chat/page-options';
import type { LauncherLook, LauncherTexts } from '../protocol/launcher';
import { type HostEvent, type HostEventListener, hostEvent } from './host-events';
// Minified at build time by Lightning CSS (vite.loader.config.ts sets the browsers).
import STYLES from './loader.css?inline';

type Command = 'open' | 'close' | 'toggle';

/** What a page may change at runtime (ADR-0008, ADR-0014): texts, its context and the language. */
interface ConfigureOptions {
  /** Greeting on the welcome screen, for example per page. */
  readonly greeting?: string;
  /** Suggested questions on the welcome screen, up to 4. */
  readonly starters?: readonly string[];
  /** Describes the page to the assistant; passed on as untrusted data, at most 1000 characters. */
  readonly context?: string;
  /**
   * The chat's language, a BCP 47 tag such as 'pl', for a bot set to `locale: 'auto'`
   * (ADR-0014). The chat reloads in it and keeps the conversation. A call with only `locale`
   * keeps the greeting, starters and context set before.
   */
  readonly locale?: string;
}

interface AskdareGlobal {
  (command: Command): void;
  (command: 'configure', options: ConfigureOptions): void;
  /** A JWT from the site's backend for the signed-in user, or null on sign-out (ADR-0009). */
  (command: 'identify', token: string | null): void;
  /**
   * Calls the listener with each chat event of this type, or of every type with '*' (ADR-0013).
   * Returns a function that removes it; through the stub, before the script loads, use 'off'.
   */
  (command: 'on', type: string, listener: HostEventListener): () => void;
  (command: 'off', type: string, listener: HostEventListener): void;
  readonly loaded: true;
}

/** The stub a page may define before the script loads: calls queue up in `q`. */
interface AskdareStub {
  (...args: unknown[]): void;
  q?: unknown[][];
}

/** Keeps only the allowed fields with the right types; the iframe and server check them again. */
function configureMessage(input: Record<string, unknown>): Record<string, unknown> {
  const message: Record<string, unknown> = { v: 1, type: 'configure' };
  if (typeof input['greeting'] === 'string') message['greeting'] = input['greeting'];
  if (typeof input['context'] === 'string') message['context'] = input['context'];
  if (Array.isArray(input['starters'])) {
    message['starters'] = input['starters'].filter((item) => typeof item === 'string');
  }
  return message;
}

declare global {
  interface Window {
    askdare?: AskdareGlobal | AskdareStub;
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * A 24 × 24 icon, built node by node: `innerHTML` throws on a page that enforces Trusted Types
 * (`require-trusted-types-for 'script'`), and the launcher would never mount there (ADR-0033).
 */
function svgIcon(size: string, d: string, paint: Readonly<Record<string, string>>): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    ...paint,
  })) {
    icon.setAttribute(name, value);
  }
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  icon.append(path);
  return icon;
}

/**
 * Each bot's launcher look, inlined by the server (see LAUNCHER_PLACEHOLDER): the requested bot's,
 * and a default one under '' for a tag with only `data-bot` or another bot (server/launcher.ts).
 */
function looks(): Record<string, LauncherLook> {
  try {
    return JSON.parse('__ASKDARE_LAUNCHERS__') as Record<string, LauncherLook>;
  } catch {
    return {};
  }
}

function boot(): void {
  const existing = window.askdare as Partial<AskdareGlobal> & AskdareStub;
  if (existing?.loaded) return;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.src) return;
  const scriptUrl = new URL(script.src);
  const botId = script.dataset['bot'] ?? scriptUrl.searchParams.get('bot');
  if (!botId) {
    console.warn('[askdare] Load the widget as widget.js?bot=<bot id>.');
    return;
  }
  const appOrigin = scriptUrl.origin;
  const basePath = scriptUrl.pathname.replace(/\/widget\.js$/, '');
  // Inline: the chat fills an element of the page instead of floating. data-launcher="none":
  // the page opens the chat from its own button, with askdare('open').
  const target = script.dataset['mode'] === 'inline' ? script.dataset['target'] : undefined;
  const find = (): Element | null => {
    try {
      return target ? document.querySelector(target) : null;
    } catch {
      return null; // An invalid selector: warned about below, and the chat floats instead.
    }
  };
  // An async script can run before the page has parsed its target (say, hoisted into <head>).
  if (target && !find() && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(script, find(), botId), {
      once: true,
    });
  } else {
    mount(script, find(), botId);
  }

  function mount(script: HTMLScriptElement, container: Element | null, botId: string): void {
    // A second copy of the snippet may have mounted while this one waited for the page.
    const current = window.askdare as Partial<AskdareGlobal> & AskdareStub;
    if (current?.loaded) return;
    // Calls made through the documented stub, up to now: some may come while mounting waits.
    const queued = Array.isArray(current?.q) ? current.q : [];
    if (target && !container) console.warn(`[askdare] No element matches ${target}.`);
    const inline = container !== null;
    const withLauncher = !inline && script.dataset['launcher'] !== 'none';
    /** The page's `<html lang>` as last seen, for data-follow-lang. */
    let pageLang = document.documentElement.lang;
    /** The chat's language for bots set to `auto`: the page's, until it switches (ADR-0014). */
    let lang = pageLocale(pageLang);
    // The language, and the mode, for the chat's own controls.
    const embedUrl = (): string => {
      const search = new URLSearchParams({
        ...(lang ? { lang } : {}),
        ...(inline ? { mode: 'inline' } : {}),
      }).toString();
      return `${appOrigin}${basePath}/embed/${encodeURIComponent(botId)}${search ? `?${search}` : ''}`;
    };

    const all = looks();
    const look = (all[botId] ?? all['']) as LauncherLook;
    const textsFor = (): LauncherTexts => {
      // No language on the page: then the visitor's browser decides.
      const language = (look.locale || lang || navigator.language).toLowerCase().split('-')[0];
      return (look.texts[language ?? 'en'] ?? look.texts['en']) as LauncherTexts;
    };
    let texts: LauncherTexts;
    const host = document.createElement('div');
    host.dataset['askdare'] = botId;
    host.dataset['askdareScheme'] = look.scheme;
    // CSSOM, not a style attribute: allowed under a strict CSP on the host page.
    for (const [name, value] of [
      ['--a', look.accent],
      ['--o', look.onAccent],
      ['--b', look.orb],
      ['--l', look.light],
      ['--d', look.dark],
      ['--t', look.text],
      ['--u', look.textDark],
      ['--r', `min(${look.radius}, 24px)`],
    ] as const) {
      host.style.setProperty(name, value);
    }
    const shadow = host.attachShadow({ mode: 'open' });
    // A constructed stylesheet is not inline style, so a site's strict CSP doesn't block it. Every
    // supported browser has them (docs/support.md).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    shadow.adoptedStyleSheets = [sheet];
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = look.style;
    launcher.setAttribute('part', 'launcher');
    launcher.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.style.display = 'contents';
    const chatIcon = svgIcon(
      '26',
      'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16h-.5A.5.5 0 0 1 4 15.5z',
      { fill: 'currentColor' },
    );
    const closeIcon = svgIcon('22', 'M6 6l12 12M18 6 6 18', {
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
    });
    // Put back in the page on every swap, so the turn animation plays again.
    const showIcon = (open: boolean): void => {
      icon.replaceChildren(...(open ? [closeIcon] : look.style === 'circle' ? [chatIcon] : []));
    };
    showIcon(false);
    const label = document.createElement('span');
    if (look.style === 'pill' || look.style === 'orb') {
      // The pill shows the bot's picture or initials; the orb launcher, the orb.
      const avatar = document.createElement('span');
      avatar.className = look.style === 'orb' ? 'ob' : 'av';
      if (look.style === 'pill') avatar.textContent = look.initials;
      if (look.style === 'pill' && look.avatar) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = look.avatar.startsWith('/') ? `${appOrigin}${look.avatar}` : look.avatar;
        // Blocked by the site's CSP or missing: keep the initials.
        image.onload = () => avatar.replaceChildren(image);
      }
      label.className = 'lb';
      // A part, so a site can hide it on small screens: the button keeps its aria-label.
      label.setAttribute('part', 'launcher-label');
      launcher.append(avatar, label);
    }
    launcher.append(icon);
    const panel = document.createElement('div');
    panel.setAttribute('part', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.hidden = true;
    if (inline) panel.className = 'inline';
    else if (!withLauncher) panel.className = 'solo';
    shadow.append(panel);
    if (withLauncher) shadow.append(launcher);

    let iframe: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
    /** The page's askdare('on') listeners. */
    const events = eventListeners<HostEvent>();
    /** The chat said it is up. Until then, a timer watches for a chat that never loads. */
    let ready = false;
    let notice: HTMLElement | undefined;
    /**
     * The chat didn't load: most often the page's site isn't in the bot's allowlist, so the app
     * refuses to be framed here (CSP frame-ancestors), or the bot ID is wrong. Say so in the
     * panel, and tell the developer where to look.
     */
    const unavailable = (): void => {
      if (ready || notice) return;
      notice = document.createElement('p');
      notice.setAttribute('part', 'unavailable');
      notice.setAttribute('role', 'status');
      notice.textContent = texts.unavailable;
      panel.append(notice);
      console.warn(
        `[askdare] The chat "${botId}" didn't load on ${location.origin}. Is this origin in the bot's security.allowedOrigins? Check with: npx @boldare/askdare doctor --origin ${location.origin}`,
      );
    };
    /** The latest configure() call, delivered once the chat is connected (and again after reloads). */
    let configured: Record<string, unknown> | undefined;
    /** The latest identify() call: sent with the handshake, so the chat's first request has it. */
    let identity: string | null | undefined;
    /** Where focus was before opening, so closing returns it (a page's own trigger, for example). */
    let returnFocus: HTMLElement | undefined;
    /** Hides the panel once its closing animation has played; cleared when it opens again. */
    let closing: ReturnType<typeof setTimeout> | undefined;
    const isOpen = (): boolean => !panel.hidden && closing === undefined;
    /** The button's name while the chat is closed. */
    let closedName = '';
    /** Puts the launcher's texts in the chat's language: on load, and on every switch. */
    const applyTexts = (): void => {
      texts = textsFor();
      // A visible label starts the button's name, as WCAG's "label in name" asks; the action follows.
      closedName =
        look.style === 'pill' || look.style === 'orb'
          ? `${texts.label}, ${texts.open}`
          : texts.open;
      launcher.setAttribute('aria-label', isOpen() ? texts.close : closedName);
      label.textContent = texts.label;
      panel.setAttribute('aria-label', texts.title);
      if (notice) notice.textContent = texts.unavailable;
    };
    applyTexts();
    let warned = false;
    /**
     * Switches the chat to another language (ADR-0014): new launcher texts, and the chat reloads
     * with the new `?lang=`. It restores the conversation, and the handshake sends the latest
     * configure() and identify() again. A bot with a fixed locale keeps it.
     */
    const switchTo = (tag: string | undefined): void => {
      if (!tag) return;
      if (look.locale) {
        if (!warned) {
          console.warn(
            `[askdare] The bot "${botId}" has a fixed locale, so it keeps its language.`,
          );
        }
        warned = true;
        return;
      }
      if (tag === lang) return;
      lang = tag;
      applyTexts();
      if (!iframe) return;
      // A connected chat switches in place and stays connected (step 2); if it can't, it reloads
      // itself and connects again.
      if (port) {
        port.postMessage({ v: 1, type: 'locale', locale: tag, inPlace: 1 });
        return;
      }
      // Not connected yet, nothing is under way: reload it from here, with replace(), so the
      // page's history gets no entry. Until it says it is up, the launcher stays reachable on
      // phones, and the watchdog looks out for a chat that doesn't come back.
      ready = false;
      delete launcher.dataset['ready'];
      setTimeout(unavailable, 8000);
      iframe.contentWindow?.location.replace(embedUrl());
    };
    const turnIcon = (open: boolean): void => {
      launcher.dataset['turned'] = '';
      showIcon(open);
    };

    const connect = (frame: HTMLIFrameElement): void => {
      // The previous port stays open: the chat's last words before a reload (an answer stopped
      // for a language switch) may still be queued on it, and its page is gone.
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event: MessageEvent<{ v?: number; type?: string; event?: unknown }>) => {
        if (event.data?.v !== 1) return;
        if (event.data.type === 'close') close();
        if (event.data.type === 'event') {
          const passed = hostEvent(event.data.event, botId);
          if (passed) events.emit(passed);
        }
        // The chat has its own close button now, so phones can hide the launcher behind it.
        if (event.data.type === 'ready') {
          ready = true;
          notice?.remove();
          notice = undefined;
          launcher.dataset['ready'] = '';
        }
      };
      // Explicit target origin: only our own app can receive the port.
      frame.contentWindow?.postMessage(
        { v: 1, type: 'askdare:init', ...(identity === undefined ? {} : { identity }) },
        appOrigin,
        [channel.port2],
      );
      if (configured) port.postMessage(configured);
    };
    // A chat page that runs after its load event, such as the site's own page at a bot's
    // embedPath (ADR-0018), asks for the handshake: only our iframe, still on our app, is answered.
    addEventListener('message', (event) => {
      const data = event.data as { v?: number; type?: string } | null;
      if (
        iframe &&
        event.source === iframe.contentWindow &&
        event.origin === appOrigin &&
        data?.v === 1 &&
        data.type === 'askdare:hello'
      ) {
        connect(iframe);
      }
    });

    const open = (focus = true): void => {
      const opening = !inline && !isOpen();
      // Opening again while the panel closes takes it back without hiding it.
      if (opening) turnIcon(true);
      if (!inline && panel.hidden) {
        // Our own launcher shows up as the host element; the page's own trigger as itself.
        const active = document.activeElement;
        returnFocus = active instanceof HTMLElement && active !== host ? active : undefined;
      }
      clearTimeout(closing);
      closing = undefined;
      delete panel.dataset['closing'];
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.title = 'Chat';
        iframe.src = embedUrl();
        iframe.referrerPolicy = 'strict-origin';
        // The iframe's own Permissions-Policy turns the microphone off unless the bot has voice input.
        iframe.allow = 'clipboard-write; microphone';
        iframe.addEventListener('load', () => iframe && connect(iframe));
        panel.append(iframe);
        setTimeout(unavailable, 8000);
      }
      panel.hidden = false;
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', texts.close);
      if (focus) iframe.focus();
      if (opening) events.emit({ type: 'open', bot: botId });
    };

    function close(): void {
      if (inline || !isOpen()) return;
      // The iframe keeps running while hidden; let it stop anything live, such as a dictation.
      port?.postMessage({ v: 1, type: 'hidden' });
      // The panel animates out first, unless the visitor asked for reduced motion.
      const hide = (): void => {
        closing = undefined;
        delete panel.dataset['closing'];
        panel.hidden = true;
      };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) hide();
      else {
        panel.dataset['closing'] = '';
        closing = setTimeout(hide, 180);
      }
      turnIcon(false);
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', closedName);
      // Back to whatever opened the chat: the page's own button, else the launcher. Firefox leaves
      // keyboard focus in the hidden iframe unless the page's window takes it first.
      const target = returnFocus?.isConnected ? returnFocus : withLauncher ? launcher : undefined;
      if (target) {
        window.focus();
        target.focus();
      }
      events.emit({ type: 'close', bot: botId });
    }

    launcher.addEventListener('click', () => (isOpen() ? close() : open()));
    // A full-screen chat (a phone, or a page zoomed to 400%) covers the page, so focus that leaves it
    // would land on something hidden (WCAG 2.4.11): it goes back to the chat until it is closed.
    if (!inline) {
      document.addEventListener('focusin', (event) => {
        if (event.target !== host && isOpen() && matchMedia('(max-width: 480px)').matches) {
          iframe?.focus();
        }
      });
    }
    (container ?? document.body ?? document.documentElement).append(host);
    // An inline chat is part of the page: it must not take focus or scroll the page on load.
    if (inline) open(false);

    const api = ((
      command: Command | 'configure' | 'identify' | 'on' | 'off',
      options?: unknown,
      listener?: HostEventListener,
    ) => {
      if (command === 'on') return events.on(options as string, listener as HostEventListener);
      if (command === 'off') events.off(options as string, listener as HostEventListener);
      else if (command === 'open') open();
      else if (command === 'close') close();
      else if (command === 'toggle') (isOpen() ? close : open)();
      else if (command === 'identify') {
        // A token, else signed out: a missing token must never keep the previous user signed in.
        if (typeof options !== 'string' && options !== null) {
          console.warn("[askdare] askdare('identify') expects a token or null; signing out.");
        }
        identity = typeof options === 'string' ? options : null;
        port?.postMessage({ v: 1, type: 'identify', token: identity });
      } else if (command === 'configure') {
        const { locale, ...page } = ((typeof options === 'object' && options) || {}) as Record<
          string,
          unknown
        >;
        if (locale !== undefined) {
          const tag = pageLocale(locale);
          if (!tag) {
            console.warn("[askdare] askdare('configure') got a locale that isn't a language tag.");
          }
          switchTo(tag);
        }
        // Only the language: the greeting, starters and context set before stay.
        const message = configureMessage(page);
        if (locale === undefined || Object.keys(message).length > 2) {
          configured = message;
          port?.postMessage(configured);
        }
      }
    }) as AskdareGlobal;
    Object.defineProperty(api, 'loaded', { value: true });
    window.askdare = api;
    // data-follow-lang: the chat follows the page's <html lang>, for sites that switch it in place.
    if (script.dataset['followLang'] !== undefined) {
      new MutationObserver(() => {
        const now = document.documentElement.lang;
        if (now === pageLang) return;
        pageLang = now;
        switchTo(pageLocale(now));
      }).observe(document.documentElement, { attributeFilter: ['lang'] });
    }
    for (const args of queued) (api as (...call: unknown[]) => void)(...args);
  }
}

boot();
