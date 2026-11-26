// Patches applied to a copy of packages/askdare/src/embed/loader.ts. Each one is a small, named,
// replayable change: l1 and l2 can apply the same edits by hand. A patch gets `{ ts, css, files }`
// (the loader without its STYLES, the STYLES text, extra files to write) and returns it changed.
// Every replacement must match, or the build stops: a stale anchor never passes silently.

/** Replaces `from` (a string, once; or a global RegExp, at least once) with `to`. */
function swap(text, from, to, name) {
  if (typeof from === 'string') {
    if (!text.includes(from)) throw new Error(`${name}: anchor not found: ${from.slice(0, 80)}`);
    return text.replace(from, () => to);
  }
  if (!from.test(text)) throw new Error(`${name}: pattern not found: ${from}`);
  from.lastIndex = 0;
  return text.replace(from, to);
}

const patch = (name, edits) => ({
  name,
  apply(source) {
    let { ts, css } = source;
    for (const [where, from, to] of edits) {
      if (where === 'ts') ts = swap(ts, from, to, name);
      else css = swap(css, from, to, name);
    }
    return { ...source, ts, css };
  },
});

// ---------------------------------------------------------------------------------------------
// Same behavior, fewer bytes (l1)
// ---------------------------------------------------------------------------------------------

/**
 * STYLES moves to `loader.css`, imported with `?inline`: Vite minifies it with Lightning CSS
 * (comments and whitespace go, colors get shorter). `build.cssTarget` must name the supported
 * browsers, or Lightning CSS expands `system-ui` into a long fallback font list.
 */
export const cssFile = { name: 'css-file', apply: (source) => ({ ...source, cssFile: true }) };

/**
 * The panel's surface colors per scheme are declared once, as `--bg` and `--fg` on `:host`, instead
 * of a dark rule and a dark media query for each element that uses them. The greeting reuses them.
 */
export const surfaceVars = patch('surface-vars', [
  [
    'css',
    ':host { all: initial; }',
    `:host { all: initial; --bg: var(--l); --fg: var(--t); }
:host([data-askdare-scheme=dark]) { --bg: var(--d); --fg: var(--u); }
@media (prefers-color-scheme: dark) {
  :host([data-askdare-scheme=auto]) { --bg: var(--d); --fg: var(--u); }
}`,
  ],
]);

export const surfaceDedupe = patch('surface-dedupe', [
  ['css', '.orb { height: 60px; padding: 0 22px 0 6px; background: var(--l); color: var(--t);', '.orb { height: 60px; padding: 0 22px 0 6px; background: var(--bg); color: var(--fg);'],
  [
    'css',
    `:host([data-askdare-scheme=dark]) .orb { background: var(--d); color: var(--u); }
@media (prefers-color-scheme: dark) {
  :host([data-askdare-scheme=auto]) .orb { background: var(--d); color: var(--u); }
}
`,
    '',
  ],
  ['css', 'overflow: hidden; border-radius: var(--r); background: var(--l);', 'overflow: hidden; border-radius: var(--r); background: var(--bg);'],
  [
    'css',
    `:host([data-askdare-scheme=dark]) [part=panel] { background: var(--d); }
@media (prefers-color-scheme: dark) {
  :host([data-askdare-scheme=auto]) [part=panel] { background: var(--d); }
}
`,
    '',
  ],
]);

/** `make(tag)` and `attr(node, name, value)` instead of document.createElement and setAttribute. */
export const helpers = patch('helpers', [
  [
    'ts',
    "import { type HostEvent, type HostEventListener, hostEvent } from './host-events';",
    `import { type HostEvent, type HostEventListener, hostEvent } from './host-events';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] =>
  document.createElement(tag);
const attr = (node: Element, name: string, value: string): void => node.setAttribute(name, value);`,
  ],
  ['ts', /document\.createElement\(/g, 'make('],
  ['ts', /(\w+)\.setAttribute\(/g, 'attr($1, '],
  // The helper's own body went through the two rewrites above; put it back.
  ['ts', '  make(tag);', '  document.createElement(tag);'],
  ['ts', '=> attr(node, name, value);', '=> node.setAttribute(name, value);'],
]);

/**
 * Every supported browser (Chrome and Edge 111, Firefox 121, Safari 16.4; docs/support.md) has
 * constructed stylesheets, so the `<style>` fallback for older Safari goes.
 */
export const noStyleFallback = patch('no-style-fallback', [
  [
    'ts',
    /    try \{\n      const sheet = new CSSStyleSheet\(\);\n      sheet\.replaceSync\(STYLES\);\n      shadow\.adoptedStyleSheets = \[sheet\];\n    \} catch \{\n[\s\S]*?\n    \}\n/g,
    `    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    shadow.adoptedStyleSheets = [sheet];
`,
  ],
]);

/** Fill attributes that draw nothing: the chat icon's fill moves to the <svg>, the close icon's goes. */
export const icons = patch('icons', [
  ['ts', '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">', '<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'],
  ['ts', ' 4 15.5z" fill="currentColor"/>', ' 4 15.5z"/>'],
  ['ts', '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"', '<svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor"'],
]);

/** Shorter developer warnings (optional: they lose detail, see FINDINGS.md). */
export const messages = patch('messages', [
  [
    'ts',
    "`[askdare] The chat \"${botId}\" didn't load on ${location.origin}. Is this origin in the bot's security.allowedOrigins? Check with: npx @boldare/askdare doctor --origin ${location.origin}`",
    "`[askdare] \"${botId}\" didn't load here. Run: npx @boldare/askdare doctor --origin ${location.origin}`",
  ],
  ['ts', '`[askdare] The bot "${botId}" has a fixed locale, so it keeps its language.`', '`[askdare] "${botId}" has a fixed locale.`'],
  ['ts', `"[askdare] askdare('identify') expects a token or null; signing out."`, `"[askdare] identify: token or null"`],
  ['ts', `"[askdare] askdare('configure') got a locale that isn't a language tag."`, `"[askdare] configure: bad locale"`],
]);

/**
 * The host events' field lists as strings (`'length attachments source'`) instead of objects of
 * ones. Writes a copy of host-events.ts next to the loader.
 */
export const compactEvents = {
  name: 'compact-events',
  apply(source) {
    const ts = swap(
      source.ts,
      "from './host-events';",
      "from './host-events-compact';",
      'compact-events',
    );
    return {
      ...source,
      ts,
      files: {
        ...source.files,
        'host-events-compact.ts': `export type HostEvent = { readonly type: string; readonly bot: string } & Readonly<
  Record<string, string | number | boolean | null>
>;
export type HostEventListener = (event: HostEvent) => void;

const FIELDS: Record<string, string> = {
  ready: '',
  open: '',
  close: '',
  'message.sent': 'length attachments source',
  'message.received': 'outcome durationMs citations',
  feedback: 'rating commented',
  error: 'code',
  'conversation.reset': '',
};

export function hostEvent(data: unknown, bot: string): HostEvent | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const input = data as Record<string, unknown>;
  const type = input['type'];
  if (typeof type !== 'string' || !Object.hasOwn(FIELDS, type)) return undefined;
  const event: Record<string, string | number | boolean | null> = { type, bot };
  for (const field of FIELDS[type]!.split(' ')) {
    const value = input[field];
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && /^[a-z_]{1,40}$/.test(value))
    ) {
      event[field] = value;
    } else if (value !== undefined) {
      return undefined;
    }
  }
  return event as HostEvent;
}
`,
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------
// New features (l2). Written against today's loader; `helpers` applied after them rewrites their
// createElement and setAttribute calls too.
// ---------------------------------------------------------------------------------------------

/** Shared by both greeting variants: when it shows, and how a site turns it off. */
const GREETING_GATE = `
    // Proactive greeting (ADR-0033): only with our own launcher, when the bot has one (its delay
    // in the look) and the page didn't turn it off (data-greeting="off"). Nothing is stored until
    // the visitor acts: dismissing it or opening the chat keeps it away for the session.
    const greetKey = \`askdare:\${botId}:greeted\`;
    const greets = withLauncher && look?.greet !== undefined && script.dataset['greeting'] !== 'off';
    let greeting: HTMLElement | undefined;
    const ungreet = (): void => {
      if (greets) {
        try {
          sessionStorage.setItem(greetKey, '1');
        } catch {}
      }
      greeting?.remove();
      greeting = undefined;
    };
    // Storage blocked: no greeting, rather than one on every page.
    let greeted = true;
    try {
      greeted = sessionStorage.getItem(greetKey) !== null;
    } catch {}
    if (greets && !greeted) setTimeout(() => iframe || greet(), look.greet);`;

/** The greeting drawn by the loader in its shadow root: the text opens the chat, × dismisses it. */
export const greetingBubble = patch('greeting-bubble', [
  [
    'css',
    '[part=panel][hidden] { display: none; }',
    `[part=panel][hidden] { display: none; }
[part=greeting] { position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;
  display: flex; align-items: flex-start; gap: 4px; max-width: min(300px, calc(100vw - 48px));
  padding: 8px; border-radius: 16px; background: var(--bg); color: var(--fg);
  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 12px 32px -10px rgb(15 23 42 / .45), 0 0 0 1px rgb(15 23 42 / .06);
  transform-origin: bottom right; animation: in .34s cubic-bezier(.3, 1.3, .5, 1); }
[part=greeting] button { all: unset; cursor: pointer; padding: 4px 8px; border-radius: 8px; }
[part=greeting] button:focus-visible { outline: 3px solid var(--a); }
[part=greeting] [aria-label] { display: grid; place-items: center; min-width: 24px; height: 24px;
  padding: 0; font-size: 20px; }`,
  ],
  ['css', '  [part=launcher], [part=panel], [part=panel][data-closing], svg, [data-turned] svg {', '  [part=launcher], [part=panel], [part=panel][data-closing], svg, [data-turned] svg, [part=greeting] {'],
  [
    'ts',
    '    (container ?? document.body ?? document.documentElement).append(host);',
    `${GREETING_GATE}
    function greet(): void {
      greeting = document.createElement('div');
      greeting.setAttribute('part', 'greeting');
      const say = document.createElement('button');
      say.type = 'button';
      say.textContent = texts.greeting;
      say.onclick = () => open();
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', texts.dismiss);
      dismiss.textContent = '×';
      // Never takes focus: it waits in the tab order, just before the launcher.
      dismiss.onclick = () => {
        ungreet();
        launcher.focus();
        events.emit({ type: 'greeting.dismissed', bot: botId });
      };
      greeting.onkeydown = (event) => event.key === 'Escape' && dismiss.click();
      greeting.append(say, dismiss);
      shadow.insertBefore(greeting, launcher);
      events.emit({ type: 'greeting.shown', bot: botId });
    }
    (container ?? document.body ?? document.documentElement).append(host);`,
  ],
  ['ts', '    const open = (focus = true): void => {', '    const open = (focus = true): void => {\n      ungreet();'],
]);

/**
 * The greeting as a tiny iframe of the app, loaded before the chat: the loader only places it and
 * listens to it. The page inside it is measured separately (greeting-frame.html).
 */
export const greetingFrame = patch('greeting-frame', [
  [
    'css',
    '[part=panel][hidden] { display: none; }',
    `[part=panel][hidden] { display: none; }
[part=greeting] { position: fixed; right: 24px; bottom: 96px; z-index: 2147483000;
  width: min(320px, calc(100vw - 48px)); height: 96px; border: 0; color-scheme: normal; }`,
  ],
  [
    'ts',
    '    (container ?? document.body ?? document.documentElement).append(host);',
    `${GREETING_GATE}
    function greet(): void {
      const frame = document.createElement('iframe');
      frame.setAttribute('part', 'greeting');
      frame.title = texts.title;
      frame.referrerPolicy = 'strict-origin';
      frame.src = embedUrl().replace(/(\\/embed\\/[^?]+)/, '$1/greeting');
      greeting = frame;
      shadow.insertBefore(frame, launcher);
      events.emit({ type: 'greeting.shown', bot: botId });
    }
    // The greeting's page says what the visitor did: open the chat, or dismiss it; and its height.
    addEventListener('message', (event) => {
      const data = event.data as { v?: number; type?: string; open?: 1; height?: number } | null;
      if (
        !(greeting instanceof HTMLIFrameElement) ||
        event.source !== greeting.contentWindow ||
        event.origin !== appOrigin ||
        data?.v !== 1 ||
        data.type !== 'askdare:greeting'
      ) {
        return;
      }
      if (data.height) greeting.style.height = \`\${Math.min(data.height, 240)}px\`;
      else if (data.open) open();
      else {
        ungreet();
        launcher.focus();
        events.emit({ type: 'greeting.dismissed', bot: botId });
      }
    });
    (container ?? document.body ?? document.documentElement).append(host);`,
  ],
  ['ts', '    const open = (focus = true): void => {', '    const open = (focus = true): void => {\n      ungreet();'],
]);

const BADGE_CSS = [
  'css',
  '[part=panel][hidden] { display: none; }',
  `[part=panel][hidden] { display: none; }
[part=badge] { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px;
  padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: #c8102e; color: #fff;
  font: 700 12px/20px system-ui, sans-serif; box-shadow: 0 0 0 2px var(--bg); }`,
];

/** The badge element, its count and the launcher's name with it ("Open chat, new messages"). */
const BADGE_TS = [
  [
    '    launcher.append(icon);',
    `    launcher.append(icon);
    /** Answers that arrived while the chat was closed (ADR-0033); cleared when it opens. */
    let unread = 0;
    const badge = document.createElement('span');
    badge.setAttribute('part', 'badge');
    badge.setAttribute('aria-hidden', 'true');
    badge.hidden = true;
    launcher.append(badge);
    const closedLabel = (): string => (unread ? \`\${closedName}, \${texts.unread}\` : closedName);
    const count = (n: number): void => {
      unread = n;
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : \`\${n}\`;
      if (!isOpen()) launcher.setAttribute('aria-label', closedLabel());
    };`,
  ],
  ["      launcher.setAttribute('aria-label', isOpen() ? texts.close : closedName);", "      launcher.setAttribute('aria-label', isOpen() ? texts.close : closedLabel());"],
  ["      launcher.setAttribute('aria-label', closedName);", "      launcher.setAttribute('aria-label', closedLabel());"],
  ['    const open = (focus = true): void => {', '    const open = (focus = true): void => {\n      if (unread) count(0);'],
].map((edit) => ['ts', ...edit]);

/** The badge counts the `message.received` events the loader already gets: no new message. */
export const badgeFromEvents = patch('badge-from-events', [
  BADGE_CSS,
  ...BADGE_TS,
  [
    'ts',
    '          if (passed) events.emit(passed);',
    `          if (passed) events.emit(passed);
          if (passed?.type === 'message.received' && passed['outcome'] === 'completed' && !isOpen()) {
            count(unread + 1);
          }`,
  ],
]);

/** The iframe sends its own count over the bridge: `{ v: 1, type: 'unread', count }`. */
export const badgeFromMessage = patch('badge-from-message', [
  BADGE_CSS,
  ...BADGE_TS,
  [
    'ts',
    "        if (event.data.type === 'close') close();",
    `        if (event.data.type === 'close') close();
        if (event.data.type === 'unread' && !isOpen()) count(Number(event.data.count) || 0);`,
  ],
  ['ts', 'port.onmessage = (event: MessageEvent<{ v?: number; type?: string; event?: unknown }>) => {', 'port.onmessage = (event: MessageEvent<{ v?: number; type?: string; event?: unknown; count?: number }>) => {'],
]);

// ---------------------------------------------------------------------------------------------
// Deeper savings, same behavior (found while measuring)
// ---------------------------------------------------------------------------------------------

/**
 * The server always inlines a look: the bot's, or a default one under '' for a script tag without
 * `?bot=` (data-bot) or an unknown bot. The loader drops its own fallback colors, texts and the
 * `look?.` checks. Server side: loaderWithLook adds `'': launcherLook(<defaults>)`.
 * Apply after the feature patches, so their `look?.` becomes `look.` too.
 */
export const serverDefaults = patch('server-defaults', [
  ['ts', 'const look = looks()[botId];', "const look = (looks()[botId] ?? looks()[''])!;"],
  [
    'ts',
    `      return (
        look?.texts[language ?? 'en'] ??
        look?.texts['en'] ?? {
          label: 'Ask us',
          open: 'Open chat',
          close: 'Close chat',
          unavailable: 'The chat couldn’t load. Please try again later.',
          title: 'Chat',
        }
      );`,
    "      return (look.texts[language ?? 'en'] ?? look.texts['en'])!;",
  ],
  [
    'ts',
    `      ['--a', look?.accent ?? '#1f5fe0'],
      ['--o', look?.onAccent ?? '#ffffff'],
      ['--b', look?.orb ?? 'var(--a)'],
      ['--l', look?.light ?? '#ffffff'],
      ['--d', look?.dark ?? '#0a0f1c'],
      ['--t', look?.text ?? '#0d1526'],
      ['--u', look?.textDark ?? '#e8edf7'],
      ['--r', look?.radius ? \`min(\${look.radius}, 24px)\` : '18px'],`,
    `      ['--a', look.accent],
      ['--o', look.onAccent],
      ['--b', look.orb],
      ['--l', look.light],
      ['--d', look.dark],
      ['--t', look.text],
      ['--u', look.textDark],
      ['--r', \`min(\${look.radius}, 24px)\`],`,
  ],
  ['ts', "host.dataset['askdareScheme'] = look?.scheme ?? 'auto';", "host.dataset['askdareScheme'] = look.scheme;"],
  ['ts', "launcher.className = look?.style ?? 'circle';", 'launcher.className = look.style;'],
  ['ts', "look?.style === 'circle' || !look ? CHAT_ICON : ''", "look.style === 'circle' ? CHAT_ICON : ''"],
  ['ts', /look\?\./g, 'look.'],
]);

/** The font stack once, on :host; the launcher (a <button>, which doesn't inherit) asks for it. */
export const fontOnHost = patch('font-on-host', [
  ['css', ':host { all: initial;', ':host { all: initial; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;'],
  ['css', '  font: 600 15px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n', '  font: inherit; font-weight: 600; line-height: 1;\n'],
  ['css', '  margin: 0; padding: 24px; background: var(--l); color: var(--t); text-align: center;\n  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }', '  margin: 0; padding: 24px; background: var(--l); color: var(--t); text-align: center; }'],
]);

/** With font-on-host: the greeting inherits the font too. */
export const greetingFont = patch('greeting-font', [
  ['css', '  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n  box-shadow: 0 12px 32px -10px', '  line-height: 1.4;\n  box-shadow: 0 12px 32px -10px'],
]);

/** Shorter warnings except the one that points at `doctor` (optional). */
export const messagesLight = patch('messages-light', [
  ['ts', '`[askdare] The bot "${botId}" has a fixed locale, so it keeps its language.`', '`[askdare] "${botId}" has a fixed locale.`'],
  ['ts', `"[askdare] askdare('identify') expects a token or null; signing out."`, `"[askdare] identify: token or null"`],
  ['ts', `"[askdare] askdare('configure') got a locale that isn't a language tag."`, `"[askdare] configure: bad locale"`],
]);

/** The greeting without its two browser events (to price them). */
export const greetingNoEvents = patch('greeting-no-events', [
  ['ts', "\n        events.emit({ type: 'greeting.dismissed', bot: botId });", ''],
  ['ts', "\n      events.emit({ type: 'greeting.shown', bot: botId });", ''],
]);

/**
 * The badge as an attribute: `data-unread="2"` on the launcher, drawn by `[data-unread]::after`.
 * No element; a site restyles it with `::part(launcher)::after`. Counts `message.received`.
 */
export const badgeAttr = patch('badge-attr', [
  [
    'css',
    '[part=panel][hidden] { display: none; }',
    `[part=panel][hidden] { display: none; }
[data-unread]::after { content: attr(data-unread); position: absolute; top: -4px; right: -4px;
  min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 10px;
  background: #c8102e; color: #fff; font: 700 12px/20px system-ui, sans-serif;
  box-shadow: 0 0 0 2px var(--bg); }`,
  ],
  [
    'ts',
    '    launcher.append(icon);',
    `    launcher.append(icon);
    /** Answers that arrived while the chat was closed (ADR-0033); cleared when it opens. */
    let unread = 0;
    const closedLabel = (): string => (unread ? \`\${closedName}, \${texts.unread}\` : closedName);
    const count = (n: number): void => {
      unread = n;
      if (n) launcher.dataset['unread'] = n > 9 ? '9+' : \`\${n}\`;
      else delete launcher.dataset['unread'];
      if (!isOpen()) launcher.setAttribute('aria-label', closedLabel());
    };`,
  ],
  ['ts', "      launcher.setAttribute('aria-label', isOpen() ? texts.close : closedName);", "      launcher.setAttribute('aria-label', isOpen() ? texts.close : closedLabel());"],
  ['ts', "      launcher.setAttribute('aria-label', closedName);", "      launcher.setAttribute('aria-label', closedLabel());"],
  ['ts', '    const open = (focus = true): void => {', '    const open = (focus = true): void => {\n      if (unread) count(0);'],
  [
    'ts',
    '          if (passed) events.emit(passed);',
    `          if (passed) events.emit(passed);
          if (passed?.type === 'message.received' && passed['outcome'] === 'completed' && !isOpen()) {
            count(unread + 1);
          }`,
  ],
]);

/**
 * The greeting's code in a second script (`greeting.<hash>.js`), fetched only for a bot with a
 * greeting, when its delay ends. The loader hands it what it needs through a callback, once.
 * The script itself is greeting-chunk.ts, measured on its own.
 */
export const greetingLazy = patch('greeting-lazy', [
  [
    'ts',
    '    (container ?? document.body ?? document.documentElement).append(host);',
    `${GREETING_GATE}
    function greet(): void {
      // The script calls this once, with the element it drew.
      (window as unknown as { askdareGreet?: unknown }).askdareGreet = (
        draw: (env: unknown) => HTMLElement,
      ) => {
        greeting = draw({ shadow, launcher, texts, open, emit: events.emit, bot: botId });
      };
      const chunk = document.createElement('script');
      chunk.src = \`\${appOrigin}\${basePath}/greeting.0123456789ab.js\`;
      document.head.append(chunk);
    }
    (container ?? document.body ?? document.documentElement).append(host);`,
  ],
  ['ts', '    const open = (focus = true): void => {', '    const open = (focus = true): void => {\n      ungreet();'],
]);
