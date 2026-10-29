// Copies the user guides, llms.txt and the license into the package, so they ship with it and match the
// installed version (`node_modules/@boldare/chatdock/docs/`). Links that leave docs/ point to GitHub.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '../..');
const GITHUB = 'https://github.com/boldare/chatdock/blob/main';
/** Contributor-only guides stay in the repository. */
const SKIP = new Set(['live-testing.md']);

const outside = (text) =>
  text
    .replaceAll(/\]\(\.\.\/([^)]+)\)/g, `](${GITHUB}/$1)`)
    .replaceAll(/\]\((adr\/[^)]+)\)/g, `](${GITHUB}/docs/$1)`);

await rm(join(pkg, 'docs'), { recursive: true, force: true });
await mkdir(join(pkg, 'docs'));
const guides = (await readdir(join(repo, 'docs'))).filter(
  (file) => file.endsWith('.md') && !SKIP.has(file),
);
for (const file of guides) {
  const text = await readFile(join(repo, 'docs', file), 'utf8');
  await writeFile(join(pkg, 'docs', file), outside(text));
}
for (const file of ['llms.txt', 'LICENSE']) {
  await writeFile(join(pkg, file), await readFile(join(repo, file), 'utf8'));
}
console.log(`copy-docs: ${guides.length} guides, llms.txt and LICENSE`);
