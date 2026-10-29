// Fails when published type declarations reference `openai` or `next` (ADR-0002).
// Usage: node scripts/check-dts-no-leak.mjs <dist-dir>
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FORBIDDEN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](openai|next)(?:\/[^'"]*)?['"]/g;

async function* declarationFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* declarationFiles(path);
    else if (/\.d\.[cm]?ts$/.test(entry.name)) yield path;
  }
}

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/check-dts-no-leak.mjs <dist-dir>');
  process.exit(2);
}

const leaks = [];
let checked = 0;
for await (const file of declarationFiles(distDir)) {
  checked += 1;
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(FORBIDDEN)) {
    leaks.push(`${file}: imports "${match[1]}" (${match[0]})`);
  }
}

if (checked === 0) {
  console.error(`No declaration files found in ${distDir}. Build first.`);
  process.exit(1);
}
if (leaks.length > 0) {
  console.error('Published types must not reference openai or next (ADR-0002):');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}
console.log(`no-leak: ${checked} declaration file(s) clean.`);
