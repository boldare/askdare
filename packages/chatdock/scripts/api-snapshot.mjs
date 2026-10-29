// The public API as published: every .d.ts in dist/, compared with the committed snapshot in
// api/chatdock.api.txt. A difference fails the check, so an API change is always deliberate:
// review it, add a changeset (ADR-0006), then run `pnpm api:update`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFile = join(pkg, 'api', 'chatdock.api.txt');
const update = process.argv.includes('--update');

/** Source map comments aren't API. (Chunk names carry no hash: tsdown `hash: false`.) */
const normalize = (text) => text.replaceAll(/^\/\/# sourceMappingURL=.*$/gm, '').trimEnd();

const files = (await readdir(join(pkg, 'dist')))
  .filter((file) => file.endsWith('.d.ts'))
  .map((file) => ({ file, name: normalize(file) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const parts = [];
for (const { file, name } of files) {
  parts.push(`// ==== ${name} ====\n${normalize(await readFile(join(pkg, 'dist', file), 'utf8'))}`);
}
const current = `${parts.join('\n\n')}\n`;

if (update) {
  await writeFile(snapshotFile, current);
  console.log(`api-snapshot: wrote ${files.length} declaration files to api/chatdock.api.txt`);
} else {
  let committed = '';
  try {
    committed = await readFile(snapshotFile, 'utf8');
  } catch {
    // No snapshot yet: report it like any other difference.
  }
  if (committed !== current) {
    const before = new Set(committed.split('\n'));
    const after = new Set(current.split('\n'));
    const removed = [...before].filter((line) => line && !after.has(line));
    const added = [...after].filter((line) => line && !before.has(line));
    console.error('The public API changed (dist/*.d.ts differs from api/chatdock.api.txt).');
    for (const line of removed.slice(0, 20)) console.error(`- ${line}`);
    for (const line of added.slice(0, 20)) console.error(`+ ${line}`);
    console.error(
      'If this is intended, add a changeset, then run: pnpm --filter @boldare/chatdock api:update',
    );
    process.exit(1);
  }
  console.log('api-snapshot: the public API matches api/chatdock.api.txt');
}
