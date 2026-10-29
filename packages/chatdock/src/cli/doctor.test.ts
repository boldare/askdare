import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import type { ModelGateway } from '../gateway';
import { createLimits } from '../limits/limits';
import { memoryStore } from '../limits/store';
import { createTokenService } from '../security/tokens';
import type { EmbedAssets } from '../server/embed-page';
import { createRequestHandler, type HandlerConfig } from '../server/handler';
import { doctor } from './doctor';

const SECRET = 'ZG9jdG9yLWNsaS10ZXN0cy1zZWNyZXQtMTIzNDU2Nzg5MA';
const URL_BASE = 'http://localhost:3000';

const assets: EmbedAssets = {
  loaderJs: 'console.log(JSON.parse(`__CHATDOCK_LAUNCHERS__`))',
  widgetJs: '',
  widgetCss: '',
  widgetJsFile: 'widget.abc123.js',
  widgetCssFile: 'widget.def456.css',
  fontsCss: '',
  fontsCssFile: 'fonts.222.css',
  fontFiles: {},
};

const gateway = {
  diagnose: async ({ model }) => [{ status: 'ok', title: `Model ${model} is available.` }],
} as Pick<ModelGateway, 'diagnose'> as ModelGateway;

function app(overrides: Partial<HandlerConfig> = {}) {
  return createRequestHandler({
    bots: [
      defineBot({
        id: 'support',
        model: 'gpt-test',
        instructions: 'x',
        security: { allowedOrigins: ['https://www.example.com'] },
      }),
    ],
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    tokens: () => createTokenService({ secret: SECRET }),
    limits: createLimits({ store: memoryStore() }),
    clientIp: () => 'ip',
    ...overrides,
  });
}

let root: string;
let output: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chatdock-doctor-'));
  await mkdir(join(root, '.git'));
  await mkdir(join(root, 'app/api/chat/[...path]'), { recursive: true });
  const installed = { next: '16.4.3', react: '19.3.1', zod: '4.6.7', '@boldare/chatdock': '0.1.0' };
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: installed }));
  for (const [name, version] of Object.entries(installed)) {
    await mkdir(join(root, 'node_modules', name), { recursive: true });
    await writeFile(
      join(root, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }
  await writeFile(
    join(root, 'app/api/chat/[...path]/route.ts'),
    'export const maxDuration = 300;\nexport const { GET, POST, DELETE } = createChatHandler({ bots });\n',
  );
  await writeFile(join(root, '.gitignore'), '.env*\n');
  await writeFile(join(root, '.env.local'), `OPENAI_API_KEY=sk-test\nCHAT_SECRET=${SECRET}\n`);
  output = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function run(
  handle: (request: Request) => Promise<Response>,
  options: { envFile?: string; url?: string; shell?: NodeJS.ProcessEnv } = {},
): Promise<{ failures: number; text: string }> {
  const failures = await doctor({
    root,
    url: options.url ?? URL_BASE,
    basePath: '/api/chat',
    envFile: options.envFile,
    shell: options.shell ?? {},
    fetch: async (input, init) => handle(new Request(input, init)),
    print: (line) => output.push(line),
  });
  return { failures, text: output.join('\n') };
}

describe('chatdock doctor', () => {
  it('passes a healthy app and reports what it checked', async () => {
    const { failures, text } = await run(app({ development: true }));
    expect(failures).toBe(0);
    expect(text).toContain('✓ next 16.4.3, react 19.3.1, zod 4.6.7, @boldare/chatdock 0.1.0');
    expect(text).toContain('✓ app/api/chat/[...path]/route.ts (maxDuration 300 s)');
    expect(text).toContain('Environment (.env.local)');
    expect(text).toContain('✓ CHAT_SECRET is strong.');
    expect(text).toContain('Bot "support"');
    expect(text).toContain('✓ Model gpt-test is available.');
    expect(text).toContain("✓ Sites that may embed the chat: 'self' https://www.example.com");
    expect(text).toContain('All good.');
    // Never echoes secrets.
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('sk-test');
  });

  it('warns about production settings that only fit one instance', async () => {
    const { text } = await run(app({ gallery: true }));
    expect(text).toContain('! The state gallery is on.');
    expect(text).toContain('! Rate limits and budgets are kept in memory, per instance.');
  });

  it('spots a proxy that redirects and headers that block embedding', async () => {
    const redirecting = async (request: Request) =>
      new URL(request.url).pathname.endsWith('/doctor')
        ? app()(request)
        : new Response(null, { status: 307, headers: { location: '/login' } });
    const redirected = await run(redirecting);
    expect(redirected.failures).toBe(2);
    expect(redirected.text).toContain(
      `✗ ${URL_BASE}/api/chat/widget.js?bot=support redirects to /login.`,
    );
    expect(redirected.text).toContain('matcher');

    output = [];
    const framed = async (request: Request) => {
      const response = await app()(request);
      const headers = new Headers(response.headers);
      headers.set('x-frame-options', 'DENY');
      headers.append('set-cookie', 'session=1');
      return new Response(response.body, { status: response.status, headers });
    };
    const blocked = await run(framed);
    expect(blocked.text).toContain(
      '✗ X-Frame-Options on the chat page stops sites from embedding it.',
    );
    expect(blocked.text).toContain("! Something sets cookies on chatdock's responses.");
  });

  it('explains a CHAT_SECRET that differs from the app, and an app that is down', async () => {
    const other = app({
      tokens: () => createTokenService({ secret: 'b3RoZXItYXBwLXNlY3JldC0xMjM0NTY3ODkwYWJjZA' }),
    });
    const mismatch = await run(other);
    expect(mismatch.text).toContain(
      "✗ The app rejected the doctor's token: its CHAT_SECRET differs from yours.",
    );

    output = [];
    const down = await run(async () => {
      throw new TypeError('fetch failed');
    });
    expect(down.text).toContain(`✗ Could not reach ${URL_BASE}/api/chat/doctor.`);
    expect(down.text).toContain('Start the app (npm run dev)');
  });

  it('checks a deployed app with only its CHAT_SECRET, which wins over the shell', async () => {
    await writeFile(join(root, '.env.production.local'), `CHAT_SECRET=${SECRET}\n`);
    const { failures, text } = await run(app(), {
      url: 'https://chat.example.com',
      envFile: './.env.production.local',
      shell: { CHAT_SECRET: 'c2hlbGwtc2VjcmV0LXRoYXQtaXMtbm90LXRoZS1hcHBz' },
    });
    expect(text).toContain('Environment (./.env.production.local)');
    expect(text).not.toContain('OPENAI_API_KEY');
    expect(text).toContain('✓ Model gpt-test is available.');
    expect(failures).toBe(0);
  });

  it('reports packages that are declared but not installed', async () => {
    await rm(join(root, 'node_modules/next'), { recursive: true });
    const { text } = await run(app());
    expect(text).toContain('✗ next is not installed.');
    expect(text).toContain('→ Run npm install.');
  });

  it('checks the local files and environment without the app', async () => {
    await writeFile(
      join(root, 'app/api/chat/[...path]/route.ts'),
      "export const runtime = 'edge';\ncreateChatHandler",
    );
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await writeFile(
      join(root, '.env.local'),
      'CHAT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nCHATDOCK_MODEL=\nIDENTITY_SECRET=short\n',
    );
    const { failures, text } = await run(app());
    expect(text).toContain('✗ app/api/chat/[...path]/route.ts uses the Edge runtime.');
    expect(text).toContain('✗ OPENAI_API_KEY is not set.');
    expect(text).toContain('✗ CHAT_SECRET must be at least 32 random characters');
    expect(text).toContain('✗ CHATDOCK_MODEL is empty.');
    expect(text).toContain('✗ IDENTITY_SECRET must be at least 32 random characters');
    expect(text).toContain('✗ .env.local holds secrets but is not in .gitignore.');
    expect(text).toContain('! Skipped: the live checks need CHAT_SECRET.');
    expect(failures).toBe(6);
  });
});
