import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFromProject, loadPgvectorIndex, POSTGRES_PACKAGE } from './kb-index';

describe('loadFromProject', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'askdare-project-'));
  });
  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it('loads the add-on installed in the project folder', async () => {
    const addOn = join(project, 'node_modules', ...POSTGRES_PACKAGE.split('/'));
    await mkdir(addOn, { recursive: true });
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    await writeFile(
      join(addOn, 'package.json'),
      JSON.stringify({ name: POSTGRES_PACKAGE, type: 'module', exports: './index.js' }),
    );
    await writeFile(
      join(addOn, 'index.js'),
      "export const pgvectorIndex = (options) => ({ from: 'project', options });",
    );
    const pgvectorIndex = await loadPgvectorIndex(loadFromProject(project));
    expect(pgvectorIndex({ indexId: 'x' } as never)).toEqual({
      from: 'project',
      options: { indexId: 'x' },
    });
  });

  it('passes other loading errors on', async () => {
    await expect(
      loadPgvectorIndex(() => Promise.reject(new SyntaxError('Unexpected token'))),
    ).rejects.toThrow(SyntaxError);
  });
});
