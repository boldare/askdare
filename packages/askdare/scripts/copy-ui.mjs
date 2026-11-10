// Ships the default look's source in the package (dist/ui/), for `npx @boldare/askdare add ui`
// to copy into an app (ADR-0011). Each file says which version it came from. The copy's index also
// exports DefaultChat, so an app changes one import after ejecting.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pkg, 'src', 'react', 'skin');
const target = join(pkg, 'dist', 'ui');
const { version } = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
const NOTE = `Ejected from @boldare/askdare@${version} with \`npx @boldare/askdare add ui\`. This copy is yours to change.`;

/** The exports an ejected copy adds to the skin's index. */
const EJECT_EXPORTS = `export type { DefaultChatProps } from './chat';
export { DefaultChat } from './chat';
`;

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const files = (await readdir(source)).filter((file) => /\.(tsx?|css)$/.test(file)).sort();
for (const file of files) {
  let text = await readFile(join(source, file), 'utf8');
  // Client components: a Server Component may import anything from the copy's index.
  if (file === 'index.ts') text = `'use client';\n\n${text}${EJECT_EXPORTS}`;
  const header = file.endsWith('.css') ? `/* ${NOTE} */\n` : `// ${NOTE}\n`;
  // A 'use client' directive stays the first statement: a comment may come before it.
  await writeFile(join(target, file), `${header}${text}`);
}
console.log(`copy-ui: ${files.length} files in dist/ui`);
