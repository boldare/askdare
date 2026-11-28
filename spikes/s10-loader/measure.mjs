// Builds today's loader and each variant exactly as packages/askdare/vite.loader.config.ts does
// (IIFE, es2020, Vite's default minifier) and prints its size gzipped the way
// scripts/inline-assets.mjs measures it (zlib defaults). Variants are today's loader.ts plus the
// patches in patches.mjs, written to gen/<variant>/ and built from there.
// Usage: node measure.mjs [--json results.json]
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'vite';
import * as p from './patches.mjs';

const BUDGET = 5 * 1024;
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const PACKAGE_SRC = '../../../../packages/askdare/src';
/** The supported browsers (docs/support.md), for Lightning CSS. */
const CSS_TARGET = ['chrome111', 'edge111', 'firefox121', 'safari16.4'];

/** Same behavior, fewer bytes: the recommendation for l1. */
const LEAN = [p.cssFile, p.surfaceVars, p.surfaceDedupe, p.noStyleFallback, p.icons, p.serverDefaults];
/** Feature patches are written against today's source: they go before helpers and server-defaults. */
const withFeatures = (features, base = LEAN) => {
  const at = base.findIndex((patch) => patch === p.helpers || patch === p.serverDefaults);
  return at < 0 ? [...base, ...features] : [...base.slice(0, at), ...features, ...base.slice(at)];
};
const without = (...out) => LEAN.filter((patch) => !out.includes(patch));
const plus = (...more) => {
  const at = LEAN.indexOf(p.serverDefaults);
  return [...LEAN.slice(0, at), ...more, ...LEAN.slice(at)];
};

/** [variant, patches, what it shows] */
const VARIANTS = [
  ['today', [], "today's loader.ts, rebuilt"],
  // Same behavior, cumulative (l1).
  ['1 css-file', [p.cssFile], 'STYLES in loader.css?inline, minified by Lightning CSS'],
  ['2 +surface', [p.cssFile, p.surfaceVars, p.surfaceDedupe], 'scheme colors declared once on :host'],
  ['3 +no-style-fallback', [p.cssFile, p.surfaceVars, p.surfaceDedupe, p.noStyleFallback], 'no <style> fallback for Safari < 16.4'],
  ['4 +icons', [p.cssFile, p.surfaceVars, p.surfaceDedupe, p.noStyleFallback, p.icons], 'fill attributes that draw nothing'],
  ['5 +server-defaults = lean', LEAN, 'the fallback look comes from the server'],
  // Each saving alone, on today's loader.
  ['only css-file', [p.cssFile], ''],
  ['only surface', [p.surfaceVars, p.surfaceDedupe], ''],
  ['only no-style-fallback', [p.noStyleFallback], ''],
  ['only icons', [p.icons], ''],
  ['only server-defaults', [p.serverDefaults], ''],
  ['only helpers', [p.helpers], 'rejected'],
  ['only font-on-host', [p.fontOnHost], 'rejected'],
  ['only compact-events', [p.compactEvents], 'rejected'],
  ['only messages-light', [p.messagesLight], 'optional'],
  ['only messages', [p.messages], 'optional'],
  // Leave one out of lean, and the rejected ones added to it.
  ['lean -css-file', without(p.cssFile), ''],
  ['lean -surface', without(p.surfaceVars, p.surfaceDedupe), ''],
  ['lean -no-style-fallback', without(p.noStyleFallback), ''],
  ['lean -icons', without(p.icons), ''],
  ['lean -server-defaults', without(p.serverDefaults), ''],
  ['lean +helpers', plus(p.helpers), 'rejected'],
  ['lean +font-on-host', plus(p.fontOnHost), 'rejected'],
  ['lean +compact-events', [...LEAN, p.compactEvents], 'rejected'],
  ['lean +messages-light', [...LEAN, p.messagesLight], 'optional: shorter warnings, doctor hint kept'],
  ['lean +messages', [...LEAN, p.messages], 'optional: all warnings shorter'],
  // Features on today's loader.
  ['today +bubble', [p.surfaceVars, p.greetingBubble], 'greeting drawn by the loader'],
  ['today +frame', [p.surfaceVars, p.greetingFrame], 'greeting in a tiny early iframe'],
  ['today +badge(element)', [p.surfaceVars, p.badgeFromEvents], 'badge element, from message.received'],
  ['today +badge(attr)', [p.surfaceVars, p.badgeAttr], 'badge as data-unread + ::after'],
  ['today +bubble +badge(attr)', [p.surfaceVars, p.greetingBubble, p.badgeAttr], ''],
  // Features on the lean loader (l2).
  ['lean +bubble', withFeatures([p.greetingBubble]), ''],
  ['lean +frame', withFeatures([p.greetingFrame]), ''],
  ['lean +lazy', withFeatures([p.greetingLazy]), 'greeting code in a second script'],
  ['lean +badge(element)', withFeatures([p.badgeFromEvents]), ''],
  ['lean +badge(element, message)', withFeatures([p.badgeFromMessage]), 'the iframe sends the count'],
  ['lean +badge(attr)', withFeatures([p.badgeAttr]), ''],
  ['lean +bubble +badge(attr)', withFeatures([p.greetingBubble, p.badgeAttr]), 'the recommendation'],
  ['lean +bubble(no events) +badge(attr)', withFeatures([p.greetingBubble, p.greetingNoEvents, p.badgeAttr]), 'prices the two greeting events'],
  ['lean +bubble +badge(element)', withFeatures([p.greetingBubble, p.badgeFromEvents]), ''],
  ['lean +frame +badge(attr)', withFeatures([p.greetingFrame, p.badgeAttr]), ''],
  ['lean +lazy +badge(attr)', withFeatures([p.greetingLazy, p.badgeAttr]), ''],
  ['lean +bubble +badge(attr) +messages-light', [...withFeatures([p.greetingBubble, p.badgeAttr]), p.messagesLight], ''],
];

const original = await readFile(here('../../packages/askdare/src/embed/loader.ts'), 'utf8');
const stylesMatch = /const STYLES = `([\s\S]*?)`;/.exec(original);
if (!stylesMatch) throw new Error('STYLES not found in loader.ts');

async function generate(name, patches) {
  let source = {
    ts: original.replace(stylesMatch[0], 'const STYLES = `__CSS__`;'),
    css: stylesMatch[1],
    files: {},
    cssFile: false,
  };
  for (const patch of patches) source = patch.apply(source);
  let ts = source.ts
    .replaceAll("from '../", `from '${PACKAGE_SRC}/`)
    .replace("from './host-events';", `from '${PACKAGE_SRC}/embed/host-events';`);
  ts = source.cssFile
    ? ts.replace('const STYLES = `__CSS__`;', "import STYLES from './loader.css?inline';")
    : ts.replace('`__CSS__`', () => `\`${source.css}\``);
  const dir = here(`gen/${slug(name)}/`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}loader.ts`, ts);
  if (source.cssFile) await writeFile(`${dir}loader.css`, source.css);
  for (const [file, content] of Object.entries(source.files)) await writeFile(dir + file, content);
  return dir;
}

const slug = (name) => name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

const rows = [];
let base;
for (const [name, patches, note] of VARIANTS) {
  const dir = await generate(name, patches);
  const outDir = here(`out/${slug(name)}`);
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2020',
      cssTarget: CSS_TARGET,
      minify: true,
      sourcemap: false,
      lib: { entry: `${dir}loader.ts`, formats: ['iife'], name: 'askdareLoader', fileName: () => 'loader.js' },
    },
  });
  const js = await readFile(`${outDir}/loader.js`, 'utf8');
  if ((js.match(/(['"`])__ASKDARE_LAUNCHERS__\1/g) ?? []).length !== 1) {
    throw new Error(`${name}: the launcher placeholder must appear exactly once`);
  }
  const gzip = gzipSync(js).length;
  base ??= gzip;
  rows.push({ variant: name, raw: js.length, gzip, 'vs today': gzip - base, 'room left': BUDGET - gzip, brotli: brotliCompressSync(js).length, note });
}

// The second script of the lazy variant, built like the loader.
{
  const outDir = here('out/greeting-chunk');
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir, emptyOutDir: true, target: 'es2020', cssTarget: CSS_TARGET, minify: true,
      lib: { entry: here('greeting-chunk.ts'), formats: ['iife'], name: 'askdareGreeting', fileName: () => 'chunk.js' },
    },
  });
  const js = await readFile(`${outDir}/chunk.js`, 'utf8');
  rows.push({ variant: 'greeting-chunk.js', raw: js.length, gzip: gzipSync(js).length, 'vs today': '', 'room left': '', brotli: brotliCompressSync(js).length, note: 'the lazy variant\'s second script, plus a request' });
}

// The page inside the greeting iframe (variant "frame"): what each visitor downloads on top.
const frame = await readFile(here('greeting-frame.html'), 'utf8');
rows.push({ variant: 'greeting-frame.html', raw: frame.length, gzip: gzipSync(frame).length, 'vs today': '', 'room left': '', brotli: brotliCompressSync(frame).length, note: 'the iframe page, per visitor, plus a request' });

console.table(rows);
const json = process.argv.indexOf('--json');
if (json > 0) await writeFile(process.argv[json + 1], `${JSON.stringify(rows, null, 2)}\n`);
