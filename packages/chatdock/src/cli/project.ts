import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

/** The version installed in `node_modules`; undefined when the package isn't installed. */
export function installedVersion(project: Project, name: string): string | undefined {
  let version: string | undefined;
  // Up to the repository root: monorepos hoist packages there.
  findUp(project.root, (dir) => {
    try {
      const manifest = readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8');
      version = (JSON.parse(manifest) as { version?: string }).version;
      return true;
    } catch {
      return false;
    }
  });
  return version;
}

/** Whether a version (or range like `^4.1.0`) is at least `major.minor`; undefined if unreadable. */
export function atLeast(
  version: string | undefined,
  major: number,
  minor = 0,
): boolean | undefined {
  const match = /(\d+)(?:\.(\d+))?/.exec(version ?? '');
  if (match?.[1] === undefined) return undefined;
  const [have, haveMinor] = [Number(match[1]), Number(match[2] ?? 0)];
  return have > major || (have === major && haveMinor >= minor);
}

export function majorOf(version: string | undefined): number | undefined {
  const match = /(\d+)/.exec(version ?? '');
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
 * Environment as `next dev` sees it: the shell, then `.env.development.local`, `.env.local`,
 * `.env.development` and `.env`. An explicit `envFile` wins over the shell instead: it is what
 * the user asked to check. Read without changing `process.env`.
 */
export async function readEnv(
  root: string,
  envFile?: string,
  shell: NodeJS.ProcessEnv = process.env,
): Promise<{
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly files: string[];
}> {
  const files = envFile
    ? [envFile]
    : ['.env.development.local', '.env.local', '.env.development', '.env'];
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
  return { env: envFile ? { ...shell, ...env } : { ...env, ...shell }, files: loaded };
}

/** Whether git ignores `name`, a file in `root`: git's own answer, or 'unknown' without git. */
function gitCheckIgnore(root: string, name: string): Promise<boolean | 'unknown'> {
  return new Promise((done) => {
    // Without --no-index: a tracked file counts as not ignored, since it would be committed.
    execFile('git', ['check-ignore', '-q', '--', name], { cwd: root, timeout: 5_000 }, (error) => {
      if (error === null) done(true);
      else done((error as { code?: unknown }).code === 1 ? false : 'unknown');
    });
  });
}

const GLOB_ONLY = /^[^/?[\]\\]+$/;

/**
 * Whether git ignores `name`, a file in `root`. Asks git; outside a repository (or without git)
 * reads the project's own .gitignore, and answers no whenever a line is beyond a simple glob.
 */
export async function gitIgnores(root: string, name: string): Promise<boolean> {
  const verdict = await gitCheckIgnore(root, name);
  if (verdict !== 'unknown') return verdict;
  let text: string;
  try {
    text = await readFile(join(root, '.gitignore'), 'utf8');
  } catch {
    return false;
  }
  let ignored = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negated = trimmed.startsWith('!');
    // A leading slash anchors the pattern to this folder, which is where `name` is.
    const pattern = (negated ? trimmed.slice(1) : trimmed).replace(/^\//, '');
    if (!GLOB_ONLY.test(pattern)) {
      if (negated) return false;
      continue;
    }
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|]/g, '\\$&').replaceAll('*', '[^/]*')}$`,
    );
    // The last matching line wins, as in git.
    if (regex.test(name)) ignored = !negated;
  }
  return ignored;
}
