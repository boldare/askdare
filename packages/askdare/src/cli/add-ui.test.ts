import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AddUiError, addUi } from './add-ui';

let root: string;
let source: string;
let output: string[];

async function app(files: Record<string, string> = {}): Promise<void> {
  const all = {
    'package.json': JSON.stringify({ dependencies: { next: '16.4.3', react: '19.3.1' } }),
    'app/page.tsx': 'export default function Page() { return null; }',
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), text);
  }
}

const run = (dir?: string) => addUi({ root, dir, source, print: (line) => output.push(line) });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'askdare-add-ui-'));
  source = await mkdtemp(join(tmpdir(), 'askdare-ui-'));
  output = [];
  await writeFile(join(source, 'index.ts'), "export { DefaultChat } from './chat';\n");
  await writeFile(join(source, 'chat.tsx'), '// the chat\n');
  await writeFile(join(source, 'askdare.css'), '/* styles */\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(source, { recursive: true, force: true });
});

describe('askdare add ui', () => {
  it('copies the look into components/askdare and says which import to change', async () => {
    await app();
    await run();
    expect((await readdir(join(root, 'components/askdare'))).sort()).toEqual([
      'askdare.css',
      'chat.tsx',
      'index.ts',
    ]);
    expect(await readFile(join(root, 'components/askdare/chat.tsx'), 'utf8')).toBe('// the chat\n');
    expect(output.join('\n')).toContain("+ import { DefaultChat } from '@/components/askdare';");
  });

  it('follows an app that keeps its code in src/', async () => {
    await app({ 'app/page.tsx': '', 'src/app/page.tsx': '' });
    await rm(join(root, 'app'), { recursive: true });
    await run();
    expect(await readdir(join(root, 'src/components/askdare'))).toHaveLength(3);
    expect(output.join('\n')).toContain("from '@/components/askdare';");
  });

  it('puts it where --dir says', async () => {
    await app();
    await run('ui/chat');
    expect(await readdir(join(root, 'ui/chat'))).toHaveLength(3);
    expect(output.join('\n')).toContain("from '@/ui/chat';");
  });

  it('never overwrites: one file in the way and nothing is written', async () => {
    await app({ 'components/askdare/chat.tsx': '// mine\n' });
    await expect(run()).rejects.toThrow(/already has chat\.tsx\. Nothing was written/);
    expect(await readdir(join(root, 'components/askdare'))).toEqual(['chat.tsx']);
    expect(await readFile(join(root, 'components/askdare/chat.tsx'), 'utf8')).toBe('// mine\n');
  });

  it('refuses a folder outside the app and a project without Next.js or React', async () => {
    await app();
    await expect(run('../elsewhere')).rejects.toThrow(AddUiError);
    await expect(run('.')).rejects.toThrow(AddUiError);
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '16' } }));
    await expect(run()).rejects.toThrow(/needs React 19/);
    await writeFile(join(root, 'package.json'), '{}');
    await expect(run()).rejects.toThrow(/no Next\.js app/);
  });
});
