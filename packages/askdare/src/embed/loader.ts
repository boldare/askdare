/**
 * askdare loader: the only code that runs on the host page. It draws a launcher inside a shadow
 * root, creates the chat iframe on first open and talks to it over a MessagePort (ADR-0005).
 * Usage: <script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
 * (`data-bot="support"` on the tag works too; `?bot=` also brings the bot's launcher look.)
 */

import type { LauncherLook } from '../protocol/launcher';

type Command = 'open' | 'close' | 'toggle';

/** What a page may change at runtime (ADR-0008): texts and its own context, nothing else. */
interface ConfigureOptions {
  /** Greeting on the welcome screen, for example per page. */
  readonly greeting?: string;
  /** Suggested questions on the welcome screen, up to 4. */
  readonly starters?: readonly string[];
  /** Describes the page to the assistant; passed on as untrusted data, at most 1000 characters. */
  readonly context?: string;
}

interface AskdareGlobal {
  (command: Command): void;
  (command: 'configure', options: ConfigureOptions): void;
  /** A JWT from the site's backend for the signed-in user, or null on sign-out (ADR-0009). */
  (command: 'identify', token: string | null): void;
  readonly loaded: true;
}

/** The stub a page may define before the script loads: calls queue up in `q`. */
interface AskdareStub {
  (...args: unknown[]): void;
  q?: unknown[][];
}

/** Keeps only the allowed fields with the right types; the iframe and server check them again. */
function configureMessage(options: unknown): Record<string, unknown> {
  const input = (typeof options === 'object' && options !== null ? options : {}) as Record<
    string,
    unknown
  >;
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

// Short custom property names keep the loader small: a accent, o text on accent, b orb,
// l and d panel background (light, dark), t and u text on them, r panel radius.
const STYLES = `
:host { all: initial; }
[part=launcher] {
  position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  min-width: 56px; height: 56px; padding: 0; border: 0; border-radius: 999px;
  background: var(--a); color: var(--o); cursor: pointer;
  font: 600 15px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 12px 32px -10px rgb(15 23 42 / .45), 0 2px 6px rgb(15 23 42 / .16);
  transition: transform .16s ease, box-shadow .16s ease;
}
[part=launcher]:hover { transform: translateY(-2px); }
[part=launcher]:focus-visible { outline: 3px solid var(--a); outline-offset: 3px; }
.pill { padding: 0 22px 0 6px; }
.av { display: grid; place-items: center; width: 44px; height: 44px; overflow: hidden;
  border-radius: 50%; background: var(--o); color: var(--a); font-size: 14px; }
.av img { width: 100%; height: 100%; object-fit: cover; }
/* The orb launcher: the orb with its label, on the panel's background, so it reads as a chat. */
.orb { height: 60px; padding: 0 22px 0 6px; background: var(--l); color: var(--t);
  box-shadow: 0 14px 34px -12px var(--a), 0 2px 8px rgb(15 23 42 / .12),
    0 0 0 1px rgb(15 23 42 / .06); }
:host([data-askdare-scheme=dark]) .orb { background: var(--d); color: var(--u); }
@media (prefers-color-scheme: dark) {
  :host([data-askdare-scheme=auto]) .orb { background: var(--d); color: var(--u); }
}
.ob { position: relative; width: 48px; height: 48px; border-radius: 50%; background: var(--b);
  box-shadow: inset 0 -5px 12px rgb(0 0 0 / .18), inset 0 4px 10px rgb(255 255 255 / .6); }
.ob::after { content: ""; position: absolute; top: 12%; left: 20%; width: 36%; height: 28%;
  border-radius: 50%; background: radial-gradient(closest-side, #fffe, #fff0); }
[aria-expanded=true], :host .orb[aria-expanded=true] { background: var(--a); color: var(--o); }
[aria-expanded=true] .av, [aria-expanded=true] .ob, [aria-expanded=true] .lb { display: none; }
.pill[aria-expanded=true], .orb[aria-expanded=true] { padding: 0; width: 56px; }
[part=panel] {
  position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;
  width: min(400px, calc(100vw - 48px)); height: min(680px, calc(100dvh - 120px));
  overflow: hidden; border-radius: var(--r); background: var(--l);
  box-shadow: 0 28px 70px -12px rgb(15 23 42 / .4), 0 0 0 1px rgb(15 23 42 / .06);
  transform-origin: bottom right; animation: in .22s cubic-bezier(.2, .8, .2, 1);
}
:host([data-askdare-scheme=dark]) [part=panel] { background: var(--d); }
@media (prefers-color-scheme: dark) {
  :host([data-askdare-scheme=auto]) [part=panel] { background: var(--d); }
}
[part=panel][hidden] { display: none; }
[part=unavailable] { position: absolute; inset: 0; display: grid; place-items: center;
  margin: 0; padding: 24px; background: var(--l); color: var(--t); text-align: center;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
[part=panel].solo { bottom: 24px; }
[part=panel].inline { position: relative; width: 100%; height: 100%; border-radius: inherit;
  box-shadow: none; animation: none; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
@keyframes in { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@media (max-width: 480px) {
  [part=panel] { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; }
  [aria-expanded=true][data-ready] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  [part=launcher], [part=panel] { transition: none; animation: none; }
}
`;

const CHAT_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16h-.5A.5.5 0 0 1 4 15.5z" fill="currentColor"/></svg>';
const CLOSE_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** Each bot's launcher look, inlined by the server (see LAUNCHER_PLACEHOLDER). */
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
    // The page's language, for bots set to `auto`, and the mode, for the chat's own controls.
    const hostLang = document.documentElement.lang;
    const query = new URLSearchParams({
      ...(hostLang ? { lang: hostLang } : {}),
      ...(inline ? { mode: 'inline' } : {}),
    });
    const search = query.toString();
    const embedUrl = `${appOrigin}${basePath}/embed/${encodeURIComponent(botId)}${
      search ? `?${search}` : ''
    }`;

    const look = looks()[botId];
    // `lang` is '' on pages without one: then the visitor's browser decides.
    const language = (look?.locale || hostLang || navigator.language).toLowerCase().split('-')[0];
    const texts = look?.texts[language ?? 'en'] ??
      look?.texts['en'] ?? {
        label: 'Ask us',
        open: 'Open chat',
        close: 'Close chat',
        unavailable: 'The chat couldn’t load.',
        title: 'Chat',
      };
    const host = document.createElement('div');
    host.dataset['askdare'] = botId;
    host.dataset['askdareScheme'] = look?.scheme ?? 'auto';
    // CSSOM, not a style attribute: allowed under a strict CSP on the host page.
    for (const [name, value] of [
      ['--a', look?.accent ?? '#1f5fe0'],
      ['--o', look?.onAccent ?? '#ffffff'],
      ['--b', look?.orb ?? 'var(--a)'],
      ['--l', look?.light ?? '#ffffff'],
      ['--d', look?.dark ?? '#0a0f1c'],
      ['--t', look?.text ?? '#0d1526'],
      ['--u', look?.textDark ?? '#e8edf7'],
      ['--r', look?.radius ? `min(${look.radius}, 24px)` : '18px'],
    ] as const) {
      host.style.setProperty(name, value);
    }
    const shadow = host.attachShadow({ mode: 'open' });
    // A constructed stylesheet is not inline style, so a site's strict CSP doesn't block it.
    // Safari before 16.4 lacks them: fall back to a <style> element.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.append(style);
    }
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = look?.style ?? 'circle';
    launcher.setAttribute('part', 'launcher');
    // A visible label starts the button's name, as WCAG's "label in name" asks; the action follows.
    const closedName =
      look?.style === 'pill' || look?.style === 'orb'
        ? `${texts.label}, ${texts.open}`
        : texts.open;
    launcher.setAttribute('aria-label', closedName);
    launcher.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.style.display = 'contents';
    const showIcon = (open: boolean): void => {
      icon.innerHTML = open ? CLOSE_ICON : look?.style === 'circle' || !look ? CHAT_ICON : '';
    };
    showIcon(false);
    if (look?.style === 'pill' || look?.style === 'orb') {
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
      const label = document.createElement('span');
      label.className = 'lb';
      label.textContent = texts.label;
      launcher.append(avatar, label);
    }
    launcher.append(icon);
    const panel = document.createElement('div');
    panel.setAttribute('part', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', texts.title);
    panel.hidden = true;
    if (inline) panel.className = 'inline';
    else if (!withLauncher) panel.className = 'solo';
    shadow.append(panel);
    if (withLauncher) shadow.append(launcher);

    let iframe: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
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

    const connect = (frame: HTMLIFrameElement): void => {
      port?.close();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event: MessageEvent<{ v?: number; type?: string }>) => {
        if (event.data?.v !== 1) return;
        if (event.data.type === 'close') close();
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

    const open = (focus = true): void => {
      if (!inline && panel.hidden) {
        // Our own launcher shows up as the host element; the page's own trigger as itself.
        const active = document.activeElement;
        returnFocus = active instanceof HTMLElement && active !== host ? active : undefined;
      }
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.title = 'Chat';
        iframe.src = embedUrl;
        iframe.referrerPolicy = 'strict-origin';
        // The iframe's own Permissions-Policy turns the microphone off unless the bot has voice input.
        iframe.allow = 'clipboard-write; microphone';
        iframe.addEventListener('load', () => iframe && connect(iframe));
        panel.append(iframe);
        setTimeout(unavailable, 8000);
      }
      panel.hidden = false;
      showIcon(true);
      launcher.setAttribute('aria-expanded', 'true');
      launcher.setAttribute('aria-label', texts.close);
      if (focus) iframe.focus();
    };

    function close(): void {
      if (inline || panel.hidden) return;
      // The iframe keeps running while hidden; let it stop anything live, such as a dictation.
      port?.postMessage({ v: 1, type: 'hidden' });
      panel.hidden = true;
      showIcon(false);
      launcher.setAttribute('aria-expanded', 'false');
      launcher.setAttribute('aria-label', closedName);
      // Back to whatever opened the chat: the page's own button, else the launcher.
      (returnFocus?.isConnected ? returnFocus : withLauncher ? launcher : undefined)?.focus();
    }

    launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
    (container ?? document.body ?? document.documentElement).append(host);
    // An inline chat is part of the page: it must not take focus or scroll the page on load.
    if (inline) open(false);

    const api = ((command: Command | 'configure' | 'identify', options?: unknown) => {
      if (command === 'open') open();
      else if (command === 'close') close();
      else if (command === 'toggle') (panel.hidden ? open : close)();
      else if (command === 'identify') {
        // A token, else signed out: a missing token must never keep the previous user signed in.
        if (typeof options !== 'string' && options !== null) {
          console.warn("[askdare] askdare('identify') expects a token or null; signing out.");
        }
        identity = typeof options === 'string' ? options : null;
        port?.postMessage({ v: 1, type: 'identify', token: identity });
      } else if (command === 'configure') {
        configured = configureMessage(options);
        port?.postMessage(configured);
      }
    }) as AskdareGlobal;
    Object.defineProperty(api, 'loaded', { value: true });
    window.askdare = api;
    for (const args of queued) (api as (...call: unknown[]) => void)(...args);
  }
}

boot();
