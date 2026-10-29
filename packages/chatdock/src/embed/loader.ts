/**
 * chatdock loader: the only code that runs on the host page. It draws a launcher inside a shadow
 * root, creates the chat iframe on first open and talks to it over a MessagePort (ADR-0005).
 * Usage: <script src="https://app.example.com/api/chat/widget.js?bot=support" async></script>
 * (`data-bot="support"` on the tag works too; `?bot=` also brings the bot's launcher look.)
 */

import type { LauncherLook } from '../protocol/launcher';

type Command = 'open' | 'close' | 'toggle';

interface ChatdockGlobal {
  (command: Command): void;
  readonly loaded: true;
}

declare global {
  interface Window {
    chatdock?: ChatdockGlobal;
  }
}

// Short custom property names keep the loader small: a accent, o text on accent, b orb,
// l and d panel background (light, dark), r panel radius.
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
.orb { width: 60px; height: 60px; background: var(--b); overflow: hidden;
  box-shadow: inset 0 -6px 14px rgb(0 0 0 / .2), inset 0 5px 12px rgb(255 255 255 / .6),
    0 14px 34px -10px var(--a); }
.orb::after { content: ""; position: absolute; top: 12%; left: 20%; width: 36%; height: 28%;
  border-radius: 50%; background: radial-gradient(closest-side, #fffe, #fff0); }
[aria-expanded=true] { background: var(--a); }
[aria-expanded=true]::after, [aria-expanded=true] .av, [aria-expanded=true] .lb { display: none; }
.pill[aria-expanded=true] { padding: 0; width: 56px; }
[part=panel] {
  position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;
  width: min(400px, calc(100vw - 48px)); height: min(680px, calc(100dvh - 120px));
  overflow: hidden; border-radius: var(--r); background: var(--l);
  box-shadow: 0 28px 70px -12px rgb(15 23 42 / .4), 0 0 0 1px rgb(15 23 42 / .06);
  transform-origin: bottom right; animation: in .22s cubic-bezier(.2, .8, .2, 1);
}
:host([data-chatdock-scheme=dark]) [part=panel] { background: var(--d); }
@media (prefers-color-scheme: dark) {
  :host([data-chatdock-scheme=auto]) [part=panel] { background: var(--d); }
}
[part=panel][hidden] { display: none; }
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
    return JSON.parse('__CHATDOCK_LAUNCHERS__') as Record<string, LauncherLook>;
  } catch {
    return {};
  }
}

function boot(): void {
  if (window.chatdock?.loaded) return;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.src) return;
  const scriptUrl = new URL(script.src);
  const botId = script.dataset['bot'] ?? scriptUrl.searchParams.get('bot');
  if (!botId) {
    console.warn('[chatdock] Load the widget as widget.js?bot=<bot id>.');
    return;
  }
  const appOrigin = scriptUrl.origin;
  const basePath = scriptUrl.pathname.replace(/\/widget\.js$/, '');
  const embedUrl = `${appOrigin}${basePath}/embed/${encodeURIComponent(botId)}`;

  const look = looks()[botId];
  const host = document.createElement('div');
  host.dataset['chatdock'] = botId;
  host.dataset['chatdockScheme'] = look?.scheme ?? 'auto';
  // CSSOM, not a style attribute: allowed under a strict CSP on the host page.
  for (const [name, value] of [
    ['--a', look?.accent ?? '#1f5fe0'],
    ['--o', look?.onAccent ?? '#ffffff'],
    ['--b', look?.orb ?? 'var(--a)'],
    ['--l', look?.light ?? '#ffffff'],
    ['--d', look?.dark ?? '#0a0f1c'],
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
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.style.display = 'contents';
  const showIcon = (open: boolean): void => {
    icon.innerHTML = open ? CLOSE_ICON : look?.style === 'circle' || !look ? CHAT_ICON : '';
  };
  showIcon(false);
  if (look?.style === 'pill') {
    const avatar = document.createElement('span');
    avatar.className = 'av';
    avatar.textContent = look.initials;
    if (look.avatar) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = look.avatar.startsWith('/') ? `${appOrigin}${look.avatar}` : look.avatar;
      // Blocked by the site's CSP or missing: keep the initials.
      image.onload = () => avatar.replaceChildren(image);
    }
    const label = document.createElement('span');
    label.className = 'lb';
    label.textContent = look.label;
    launcher.append(avatar, label);
  }
  launcher.append(icon);
  const panel = document.createElement('div');
  panel.setAttribute('part', 'panel');
  panel.hidden = true;
  shadow.append(panel, launcher);

  let iframe: HTMLIFrameElement | undefined;
  let port: MessagePort | undefined;

  const connect = (frame: HTMLIFrameElement): void => {
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (event: MessageEvent<{ v?: number; type?: string }>) => {
      if (event.data?.v !== 1) return;
      if (event.data.type === 'close') close();
      // The chat has its own close button now, so phones can hide the launcher behind it.
      if (event.data.type === 'ready') launcher.dataset['ready'] = '';
    };
    // Explicit target origin: only our own app can receive the port.
    frame.contentWindow?.postMessage({ v: 1, type: 'chatdock:init' }, appOrigin, [channel.port2]);
  };

  const open = (): void => {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'Chat';
      iframe.src = embedUrl;
      iframe.referrerPolicy = 'strict-origin';
      // The iframe's own Permissions-Policy turns the microphone off unless the bot has voice input.
      iframe.allow = 'clipboard-write; microphone';
      iframe.addEventListener('load', () => iframe && connect(iframe));
      panel.append(iframe);
    }
    panel.hidden = false;
    showIcon(true);
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close chat');
    iframe.focus();
  };

  function close(): void {
    // The iframe keeps running while hidden; let it stop anything live, such as a dictation.
    port?.postMessage({ v: 1, type: 'hidden' });
    panel.hidden = true;
    showIcon(false);
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Open chat');
    launcher.focus();
  }

  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  (document.body ?? document.documentElement).append(host);

  const api = ((command: Command) => {
    if (command === 'open') open();
    else if (command === 'close') close();
    else if (command === 'toggle') (panel.hidden ? open : close)();
  }) as ChatdockGlobal;
  Object.defineProperty(api, 'loaded', { value: true });
  window.chatdock = api;
}

boot();
