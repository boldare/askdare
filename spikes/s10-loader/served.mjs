// What a visitor actually downloads: widget.js with a bot's look inlined, as server/launcher.ts
// does (the budget measures the loader with the placeholder). Run after measure.mjs.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const texts = {
  en: { label: 'Ask us', open: 'Open chat', close: 'Close chat', unavailable: 'The chat couldn’t load. Please try again later.', title: 'Assistant' },
  pl: { label: 'Zapytaj nas', open: 'Otwórz czat', close: 'Zamknij czat', unavailable: 'Nie udało się załadować czatu. Spróbuj ponownie później.', title: 'Asystent' },
};
/** The three texts l2 adds (c4 writes the real ones); only in the look of a bot that uses them. */
const extra = {
  en: { greeting: 'Hi! I’m the AI assistant. Any questions?', dismiss: 'Dismiss', unread: 'new messages' },
  pl: { greeting: 'Cześć! Jestem asystentem AI. Masz pytania?', dismiss: 'Zamknij', unread: 'nowe wiadomości' },
};
const look = (withGreeting) => ({
  style: 'circle',
  texts: withGreeting ? { en: { ...texts.en, ...extra.en }, pl: { ...texts.pl, ...extra.pl } } : texts,
  accent: '#1f5fe0', onAccent: '#ffffff', orb: 'radial-gradient(circle at 30% 30%, #7aa7ff, #1f5fe0)',
  initials: 'AS', light: '#ffffff', dark: '#0a0f1c', text: '#0d1526', textDark: '#e8edf7',
  scheme: 'auto', radius: '18px',
  ...(withGreeting ? { greet: 8000 } : {}),
});
const serve = (js, looks) =>
  js.replace(/(['"`])__ASKDARE_LAUNCHERS__\1/, () => JSON.stringify(JSON.stringify(looks)));

const rows = [];
for (const [variant, dir, looks] of [
  ['today, ?bot=support', 'today', { support: look(false) }],
  ['today, data-bot (no look)', 'today', {}],
  ['lean, ?bot=support', '5-server-defaults-lean', { support: look(false) }],
  ['lean, data-bot (default look)', '5-server-defaults-lean', { '': look(false) }],
  ['lean +bubble +badge(attr), bot without greeting', 'lean-bubble-badge-attr', { support: look(false) }],
  ['lean +bubble +badge(attr), bot with greeting', 'lean-bubble-badge-attr', { support: look(true) }],
]) {
  const js = await readFile(new URL(`out/${dir}/loader.js`, import.meta.url), 'utf8');
  rows.push({ variant, gzip: gzipSync(serve(js, looks)).length });
}
console.table(rows);
