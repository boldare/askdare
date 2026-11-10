import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject } from './project';

export interface AddUiOptions {
  /** The Next.js app's folder. */
  readonly root: string;
  /** Where the files go, relative to `root`. Default `components/askdare`, under `src/` if the app has one. */
  readonly dir?: string | undefined;
  /** The skin's source inside the package; the default is next to the CLI (dist/ui). */
  readonly source?: string;
  readonly print: (line: string) => void;
}

export class AddUiError extends Error {}

/** `dist/ui`, next to `dist/cli.js`. */
const SHIPPED = fileURLToPath(new URL('./ui/', import.meta.url));

/**
 * `askdare add ui`: copies the default look's source into the app, shadcn-style (ADR-0011). It
 * never overwrites: if any of the files is already there, nothing is written.
 */
export async function addUi(options: AddUiOptions): Promise<void> {
  const { root, print } = options;
  const project = await readProject(root);
  if (!project.dependencies?.['next']) {
    throw new AddUiError('This folder has no Next.js app (no "next" in package.json).');
  }
  if (!project.dependencies['react']) {
    throw new AddUiError('The chat inside a page needs React 19 (no "react" in package.json).');
  }
  const inSrc = project.appDir?.endsWith(join('src', 'app'));
  const dir = options.dir ?? join(inSrc ? 'src' : '', 'components', 'askdare');
  const target = resolve(root, dir);
  // Stay inside the app: `--dir ../elsewhere` is a mistake more often than a wish.
  const inside = relative(root, target);
  if (inside === '' || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
    throw new AddUiError(`--dir must be a folder inside the app, got "${dir}".`);
  }
  const source = options.source ?? SHIPPED;
  let files: string[];
  try {
    files = (await readdir(source)).sort();
  } catch {
    throw new AddUiError('The package has no UI source (dist/ui). Reinstall @boldare/askdare.');
  }
  const existing = files.filter((file) => existsSync(join(target, file)));
  if (existing.length > 0) {
    throw new AddUiError(
      `${inside}${sep} already has ${existing.join(', ')}. Nothing was written: askdare never overwrites your files. Remove them or choose another folder with --dir.`,
    );
  }
  await mkdir(target, { recursive: true });
  for (const file of files) await copyFile(join(source, file), join(target, file));

  const shown = inside.split(sep).join('/');
  print(`Added the chat's default look to ${shown}/ (${files.length} files).`);
  print('');
  print('It is your code now. To use it, change one import where you render the chat:');
  print('');
  print(`  - import { DefaultChat } from '@boldare/askdare/react';`);
  print(`  + import { DefaultChat } from '@/${shown.replace(/^src\//, '')}';`);
  print('');
  print('Root, the hooks and the primitives still come from @boldare/askdare/react.');
  print('The stylesheet is askdare.css in that folder; see docs/react.md in the package.');
}
