// Copies the user guides, llms.txt, the agent skill and the license into the package, so they ship with
// it and match the installed version (`node_modules/@boldare/askdare/docs/`). Links that leave docs/
// point to GitHub.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(pkg, '../..');
const GITHUB = 'https://github.com/boldare/askdare/blob/main';
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
// The skill for users' AI coding agents: copied into their `.claude/skills/` from here.
await rm(join(pkg, 'skills'), { recursive: true, force: true });
await mkdir(join(pkg, 'skills/askdare'), { recursive: true });
await writeFile(
  join(pkg, 'skills/askdare/SKILL.md'),
  await readFile(join(repo, 'skills/askdare/SKILL.md'), 'utf8'),
);
console.log(`copy-docs: ${guides.length} guides, llms.txt, the askdare skill and LICENSE`);
