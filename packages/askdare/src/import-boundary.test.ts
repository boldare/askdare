// ADR-0032, decision 10: nothing the visitor's browser loads reaches the admin code. Walks the
// import graph from every file under the browser entries and fails on any path into `admin/` or
// `admin-console/`, so the loader, React and widget budgets stay what they measure.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const BROWSER_ROOTS = ['embed', 'embed-root', 'react', 'chat', 'widget-app'];
const FORBIDDEN = ['admin', 'admin-console'];
const ALIASES: Record<string, string> = {
  '@boldare/askdare/react': join(SRC, 'react/headless.ts'),
};
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function resolveImport(from: string, specifier: string): string | undefined {
  const aliased = ALIASES[specifier];
  if (aliased) return aliased;
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Every file reachable from `start`, with the import chain that reached it. */
function reachable(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (!/\.tsx?$/.test(file)) continue;
    const chain = seen.get(file) ?? [];
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? '');
      if (!target || seen.has(target)) continue;
      seen.set(target, [...chain, target]);
      queue.push(target);
    }
  }
  return seen;
}

describe('import boundaries', () => {
  it('keeps the browser entries away from the admin code', () => {
    const crossings: string[] = [];
    for (const root of BROWSER_ROOTS) {
      for (const file of filesUnder(join(SRC, root))) {
        for (const [target, chain] of reachable(file)) {
          const top = relative(SRC, target).split(/[\\/]/)[0] ?? '';
          if (FORBIDDEN.includes(top)) {
            crossings.push(chain.map((step) => relative(SRC, step)).join(' → '));
          }
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it('finds a crossing when there is one', () => {
    // The console itself reaches its own code: the walk does follow imports.
    const graph = reachable(join(SRC, 'server/handler.ts'));
    expect([...graph.keys()].some((file) => file.endsWith('server/admin-console.ts'))).toBe(true);
  });
});
