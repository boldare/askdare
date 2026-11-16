// Injected into every recorded page (Playwright addInitScript). A screencast has no mouse
// pointer, so this draws one and a ripple on clicks. It also blurs secrets before
// they are ever painted, so no frame holds a usable value (ADR-0004). Captions are added in
// edit.mjs, under the browser window, so they never cover the page.
(() => {
  if (window.__rec) return;
  const STORE = '__rec_cursor';
  const css = `
    #__rec-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; left: 0; top: 0;
      pointer-events: none; transition: transform var(--rec-ms, 0ms) cubic-bezier(.45,.05,.25,1);
      filter: drop-shadow(0 2px 3px rgb(0 0 0 / .35)); }
    .__rec-ripple { position: fixed; z-index: 2147483646; width: 36px; height: 36px; margin: -18px 0 0 -18px;
      border-radius: 50%; background: rgb(255 255 255 / .55); border: 2px solid rgb(17 17 17 / .55);
      pointer-events: none; animation: __rec-ripple .5s ease-out forwards; }
    @keyframes __rec-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    /* Secrets: the CHAT_SECRET on /deploy, and any secret-looking field on other sites. */
    .secret-value, input[type="password"], input[name*="value" i], input[name*="secret" i],
    input[name*="key" i], textarea[name*="value" i] {
      -webkit-text-security: disc !important; filter: blur(7px) !important; }
  `;
  const arrow =
    '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.6 12.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  let cursor;
  let pos = { x: 640, y: 420 };
  try {
    pos = JSON.parse(sessionStorage.getItem(STORE)) ?? pos;
  } catch {}

  const place = (x, y, ms = 0) => {
    pos = { x, y };
    try {
      sessionStorage.setItem(STORE, JSON.stringify(pos));
    } catch {}
    if (!cursor) return;
    cursor.style.setProperty('--rec-ms', `${ms}ms`);
    cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
  };

  const mount = () => {
    if (document.getElementById('__rec-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.append(style);
    cursor = document.createElement('div');
    cursor.id = '__rec-cursor';
    cursor.innerHTML = arrow;
    document.documentElement.append(cursor);
    place(pos.x, pos.y);
  };

  window.__rec = {
    /** Glide the pointer to (x, y) over `ms` milliseconds. */
    moveTo: (x, y, ms = 700) => {
      mount();
      place(x, y, ms);
      return new Promise((r) => setTimeout(r, ms));
    },
    ripple: () => {
      const r = document.createElement('div');
      r.className = '__rec-ripple';
      r.style.left = `${pos.x}px`;
      r.style.top = `${pos.y}px`;
      document.documentElement.append(r);
      setTimeout(() => r.remove(), 600);
    },
  };

  // When a person drives the page (the Vercel part), follow the real mouse.
  addEventListener('mousemove', (e) => e.isTrusted && place(e.clientX, e.clientY), true);
  addEventListener('mousedown', (e) => e.isTrusted && window.__rec.ripple(), true);

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
})();
