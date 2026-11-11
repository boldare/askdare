import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InitError, init } from './init';
import { gitIgnores } from './project';

let root: string;
let output: string[];
const run = (options: { botId?: string; model?: string } = {}) =>
  init({
    root,
    botId: options.botId ?? 'support',
    model: options.model,
    print: (line) => output.push(line),
  });

const LAYOUT = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
`;

/** A fresh `create-next-app` project, as far as init cares. */
async function nextApp(files: Record<string, string> = {}) {
  const all = {
    'package.json': JSON.stringify({ dependencies: { next: '16.4.3', react: '19.3.1' } }),
    'tsconfig.json': '{}',
    'pnpm-lock.yaml': '',
    '.gitignore': '# env files\n.env*\n',
    'app/layout.tsx': LAYOUT,
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), content);
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'askdare-init-'));
  await mkdir(join(root, '.git'));
  output = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('askdare init', () => {
  it('adds the route, a config, the environment and the chat script', async () => {
    await nextApp();
    await run({ model: 'gpt-test' });

    const route = await readFile(join(root, 'app/api/chat/[...path]/route.ts'), 'utf8');
    expect(route).toContain("import { bots } from '../../../../askdare.config';");
    expect(route).toMatch(/^export const maxDuration = 300;$/m);
    const config = await readFile(join(root, 'askdare.config.ts'), 'utf8');
    expect(config).toContain("id: 'support'");
    expect(config).toContain('process.env.ASKDARE_MODEL');
    // The starter is what init writes; one-click deploys fill in these variables.
    const starter = new URL('../../../../examples/starter/askdare.config.ts', import.meta.url);
    expect(config).toBe(await readFile(starter, 'utf8'));
    for (const name of ['ASKDARE_INSTRUCTIONS', 'ASKDARE_GREETING', 'ASKDARE_ALLOWED_ORIGINS']) {
      expect(config).toContain(`process.env.${name}`);
    }

    const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
    expect(env['OPENAI_API_KEY']).toBe('');
    expect(env['ASKDARE_MODEL']).toBe('gpt-test');
    expect(env['CHAT_SECRET']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The generated secret is never printed.
    expect(output.join('\n')).not.toContain(env['CHAT_SECRET']);

    const layout = await readFile(join(root, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain(
      '        {children}\n        <Script src="/api/chat/widget.js?bot=support" strategy="afterInteractive" />\n      </body>',
    );
    expect(layout).toContain("import Script from 'next/script';");
    expect(output.join('\n')).toContain('Install: pnpm add @boldare/askdare zod');
    expect(output.join('\n')).toContain('In .env.local, set OPENAI_API_KEY.');
  });

  it('never overwrites: a second run changes nothing', async () => {
    await nextApp({ '.env.local': 'OPENAI_API_KEY=sk-mine\n' });
    await run();
    const snapshot = await Promise.all(
      ['askdare.config.ts', 'app/api/chat/[...path]/route.ts', '.env.local', 'app/layout.tsx'].map(
        (file) => readFile(join(root, file), 'utf8'),
      ),
    );
    expect(snapshot[2]).toMatch(/^OPENAI_API_KEY=sk-mine\n\n# askdare\n/);
    expect(parseEnv(snapshot[2] ?? '')['OPENAI_API_KEY']).toBe('sk-mine');

    output = [];
    await run();
    const again = await Promise.all(
      ['askdare.config.ts', 'app/api/chat/[...path]/route.ts', '.env.local', 'app/layout.tsx'].map(
        (file) => readFile(join(root, file), 'utf8'),
      ),
    );
    expect(again).toEqual(snapshot);
    expect(output.filter((line) => line.startsWith('  + '))).toEqual([]);
  });

  it("fits create-next-app's one-line body and AGENTS.md", async () => {
    await nextApp({
      'app/layout.tsx':
        '    <html lang="en">\n      <body className={font.variable}>{children}</body>\n',
      'AGENTS.md':
        '<!-- BEGIN:nextjs-agent-rules -->\nNext.js rules\n<!-- END:nextjs-agent-rules -->\n',
    });
    await run();
    expect(await readFile(join(root, 'app/layout.tsx'), 'utf8')).toContain(
      '<body className={font.variable}>{children}<Script src="/api/chat/widget.js?bot=support" strategy="afterInteractive" /></body>',
    );
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toMatch(
      /^<!-- BEGIN:nextjs-agent-rules -->[\s\S]*END:nextjs-agent-rules -->\n\n<!-- BEGIN:askdare/,
    );
    expect(agents).toContain('node_modules/@boldare/askdare/llms.txt');
    await run();
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(agents);
  });

  it('keeps generated secrets out of git and supports src/app in JavaScript', async () => {
    await nextApp({ '.gitignore': 'node_modules\n', 'app/layout.tsx': '' });
    await rm(join(root, 'app'), { recursive: true });
    await rm(join(root, 'tsconfig.json'));
    await mkdir(join(root, 'src/app'), { recursive: true });
    await run({ botId: 'sales' });

    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('.env*.local');
    const route = await readFile(join(root, 'src/app/api/chat/[...path]/route.js'), 'utf8');
    expect(route).toContain("from '../../../../../askdare.config'");
    expect(await readFile(join(root, 'askdare.config.js'), 'utf8')).toContain("id: 'sales'");
    // No layout to edit: init says where the script goes.
    expect(output.join('\n')).toContain(
      '<Script src="/api/chat/widget.js?bot=sales" strategy="afterInteractive" />',
    );
  });

  it("asks git whether .env.local is ignored, so another folder's pattern doesn't count", async () => {
    const repo = root;
    await rm(join(repo, '.git'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    // The monorepo root ignores only its own .env.local.
    await writeFile(join(repo, '.gitignore'), '/.env.local\n');
    root = join(repo, 'apps/web');
    await nextApp({ '.gitignore': 'node_modules\n' });
    await run();
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('.env*.local');
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: root }),
    ).not.toThrow();
    root = repo;
  });

  it('reads negations and anchors without git', async () => {
    await writeFile(join(root, '.gitignore'), '.env*\n!.env.local\n/.env.test\n');
    expect(await gitIgnores(root, '.env')).toBe(true);
    expect(await gitIgnores(root, '.env.local')).toBe(false);
    expect(await gitIgnores(root, '.env.test')).toBe(true);
  });

  it("reads create-next-app's .gitignore without git: its folder negations don't count", async () => {
    await writeFile(
      join(root, '.gitignore'),
      '/node_modules\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n.env*\n.vercel\n',
    );
    expect(await gitIgnores(root, '.env.local')).toBe(true);
    expect(await gitIgnores(root, '.env.production.local')).toBe(true);
  });

  it('refuses folders that are not App Router Next.js apps, and bad bot IDs', async () => {
    await expect(run()).rejects.toThrow(InitError);
    await writeFile(join(root, 'package.json'), '{"dependencies":{"react":"19.3.1"}}');
    await expect(run()).rejects.toThrow(/not a Next.js app/);
    await nextApp();
    await expect(run({ botId: '../evil' })).rejects.toThrow(/bot ID/);
  });
});

describe('the config init writes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Writes the config with these variables set and loads it with the real defineBot, which checks it. */
  async function load(env: Record<string, string> = {}) {
    vi.stubEnv('ASKDARE_MODEL', 'gpt-test');
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    await nextApp();
    await run();
    const file = join(root, 'askdare.config.ts');
    const library = fileURLToPath(new URL('../index.ts', import.meta.url));
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace("from '@boldare/askdare'", `from '${library}'`),
    );
    const [bot] = (await import(file)).bots;
    return {
      instructions: bot.instructions({ locale: 'pl' }),
      greeting: bot.widget.greeting,
      origins: bot.security.allowedOrigins,
    };
  }
  const LANGUAGE = "Reply in the language of the visitor's message; default to pl.";

  it('keeps its defaults without the optional variables', async () => {
    const bot = await load();
    expect(bot.instructions).toMatch(/^You are the assistant on our website\. .*\n\n/s);
    expect(bot.instructions.endsWith(`\n\n${LANGUAGE}`)).toBe(true);
    expect(bot.greeting).toBe('Hi! How can I help?');
    expect(bot.origins).toEqual([]);
  });

  it('falls back to the defaults for empty or blank values', async () => {
    const bot = await load({
      ASKDARE_INSTRUCTIONS: ' ',
      ASKDARE_GREETING: '  ',
      ASKDARE_ALLOWED_ORIGINS: '',
    });
    expect(bot.instructions).toMatch(/^You are the assistant on our website\./);
    expect(bot.greeting).toBe('Hi! How can I help?');
    expect(bot.origins).toEqual([]);
  });

  it('uses the variables, trimmed, with origins split on commas and without trailing slashes', async () => {
    const bot = await load({
      ASKDARE_INSTRUCTIONS: ' You answer questions about Acme ',
      ASKDARE_GREETING: ' Cześć! ',
      ASKDARE_ALLOWED_ORIGINS: ' https://www.example.com/ , https://shop.example.com,, ',
    });
    // The language sentence stays its own paragraph, even after text without a final period.
    expect(bot.instructions).toBe(`You answer questions about Acme\n\n${LANGUAGE}`);
    expect(bot.greeting).toBe('Cześć!');
    expect(bot.origins).toEqual(['https://www.example.com', 'https://shop.example.com']);
  });
});
