/**
 * chatdock loader: the only code that runs on the host page. It draws a launcher inside a shadow
 * root, creates the chat iframe on first open and talks to it over a MessagePort (ADR-0005).
 * Usage: <script src="https://app.example.com/api/chat/widget.js" data-bot="support" async></script>
 */

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

const STYLES = `
:host { all: initial; }
[part='launcher'] {
  position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
  width: 56px; height: 56px; border: 0; border-radius: 50%;
  background: var(--chatdock-accent, #2563eb); color: #fff; cursor: pointer;
  box-shadow: 0 8px 24px rgb(15 23 42 / 0.24), 0 2px 6px rgb(15 23 42 / 0.16);
  display: grid; place-items: center; transition: transform 160ms ease;
}
[part='launcher']:hover { transform: translateY(-2px); }
[part='launcher']:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
[part='panel'] {
  position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;
  width: min(400px, calc(100vw - 48px)); height: min(640px, calc(100dvh - 120px));
  border: 0; border-radius: 16px; overflow: hidden; background: #fff;
  box-shadow: 0 24px 64px rgb(15 23 42 / 0.28);
}
[part='panel'][hidden] { display: none; }
iframe { width: 100%; height: 100%; border: 0; display: block; }
@media (max-width: 480px) {
  [part='panel'] { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; }
}
@media (prefers-reduced-motion: reduce) { [part='launcher'] { transition: none; } }
`;

const CHAT_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6A.5.5 0 0 1 5 19.2V16h-.5A.5.5 0 0 1 4 15.5z" fill="currentColor"/></svg>';

function boot(): void {
  if (window.chatdock?.loaded) return;
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement) || !script.src) return;
  const botId = script.dataset['bot'];
  if (!botId) {
    console.warn('[chatdock] Add data-bot="<bot id>" to the widget script tag.');
    return;
  }
  const scriptUrl = new URL(script.src);
  const appOrigin = scriptUrl.origin;
  const basePath = scriptUrl.pathname.replace(/\/widget\.js$/, '');
  const embedUrl = `${appOrigin}${basePath}/embed/${encodeURIComponent(botId)}`;

  const host = document.createElement('div');
  host.dataset['chatdock'] = botId;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('part', 'launcher');
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = CHAT_ICON;
  const panel = document.createElement('div');
  panel.setAttribute('part', 'panel');
  panel.hidden = true;
  shadow.append(style, panel, launcher);

  let iframe: HTMLIFrameElement | undefined;
  let port: MessagePort | undefined;

  const connect = (frame: HTMLIFrameElement): void => {
    port?.close();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (event: MessageEvent<{ v?: number; type?: string }>) => {
      if (event.data?.v === 1 && event.data.type === 'close') close();
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
      iframe.allow = 'clipboard-write';
      iframe.addEventListener('load', () => iframe && connect(iframe));
      panel.append(iframe);
    }
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close chat');
    iframe.focus();
  };

  function close(): void {
    panel.hidden = true;
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
