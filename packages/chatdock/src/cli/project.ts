import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** What the CLI needs to know about the Next.js app it runs in. */
export interface Project {
  readonly root: string;
  readonly dependencies: Readonly<Record<string, string>> | undefined;
  /** Absolute path of `app/` or `src/app/`, when the app uses the App Router. */
  readonly appDir: string | undefined;
  readonly typescript: boolean;
  readonly packageManager: PackageManager;
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/** Walks up from `start` (a monorepo keeps its lockfile and .gitignore at the top). */
export function findUp(start: string, test: (dir: string) => boolean): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    if (test(dir)) return dir;
    if (dirname(dir) === dir || existsSync(join(dir, '.git'))) return undefined;
  }
}

export async function readProject(root: string): Promise<Project> {
  let dependencies: Record<string, string> | undefined;
  try {
    const json = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    dependencies = { ...json.devDependencies, ...json.dependencies };
  } catch {
    dependencies = undefined;
  }
  const appDir = [join(root, 'app'), join(root, 'src', 'app')].find((dir) => existsSync(dir));
  let packageManager: PackageManager = 'npm';
  findUp(root, (dir) => {
    const lock = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (lock) packageManager = lock[1];
    return lock !== undefined;
  });
  return {
    root,
    dependencies,
    appDir,
    typescript: existsSync(join(root, 'tsconfig.json')),
    packageManager,
  };
}

/** The installed version of a package, else the range in package.json. */
export function installedVersion(project: Project, name: string): string | undefined {
  try {
    const require = createRequire(join(project.root, 'package.json'));
    return (require(`${name}/package.json`) as { version: string }).version;
  } catch {
    return project.dependencies?.[name];
  }
}

export function majorOf(version: string | undefined): number | undefined {
  const match = /(\d+)\.(\d+)/.exec(version ?? '') ?? /(\d+)/.exec(version ?? '');
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The catch-all route file for a base path, e.g. `app/api/chat/[...path]/route.ts`. */
export function routeDir(project: Project, basePath: string): string | undefined {
  return (
    project.appDir && join(project.appDir, ...basePath.split('/').filter(Boolean), '[...path]')
  );
}

export function findFile(dir: string | undefined, name: string): string | undefined {
  if (dir === undefined) return undefined;
  return ['ts', 'tsx', 'js', 'jsx', 'mjs']
    .map((extension) => join(dir, `${name}.${extension}`))
    .find((file) => existsSync(file));
}

/** A path relative to the project, with forward slashes, for messages. */
export function shown(project: Project, file: string): string {
  return relative(project.root, file).split(sep).join('/');
}

export function runScript(project: Project, script: string): string {
  return project.packageManager === 'npm'
    ? `npm run ${script}`
    : `${project.packageManager} ${script}`;
}

export function addCommand(project: Project, packages: readonly string[]): string {
  const add = project.packageManager === 'npm' ? 'npm install' : `${project.packageManager} add`;
  return `${add} ${packages.join(' ')}`;
}

/**
 * Environment as Next.js sees it locally: the shell wins over `.env.local`, which wins over `.env`.
 * Read without changing `process.env`.
 */
export async function readEnv(
  root: string,
  envFile?: string,
  shell: NodeJS.ProcessEnv = process.env,
): Promise<{
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly files: string[];
}> {
  const files = envFile ? [envFile] : ['.env.local', '.env'];
  const loaded: string[] = [];
  const env: Record<string, string | undefined> = {};
  for (const file of files.toReversed()) {
    let text: string;
    try {
      text = await readFile(resolve(root, file), 'utf8');
    } catch (error) {
      if (envFile) throw error;
      continue;
    }
    Object.assign(env, parseEnv(text));
    loaded.unshift(file);
  }
  return { env: { ...env, ...shell }, files: loaded };
}

/** Whether a .gitignore up the tree ignores `name` (simple patterns: `*` wildcards only). */
export async function gitIgnores(root: string, name: string): Promise<boolean> {
  const patterns: string[] = [];
  findUp(root, (dir) => {
    patterns.push(join(dir, '.gitignore'));
    return false;
  });
  for (const file of patterns) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const pattern = line.trim().replace(/^\//, '');
      if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) continue;
      const regex = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')}$`,
      );
      if (regex.test(name)) return true;
    }
  }
  return false;
}
