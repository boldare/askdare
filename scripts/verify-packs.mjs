// The packages as a user gets them: packed like `npm publish` would, installed into a fresh
// create-next-app, set up with `askdare init`, checked with `askdare doctor`, built with Turbopack
// and with webpack, and one chat message sent against a mock OpenAI. Run it before every release
// candidate (it needs the network for npm):
//   node scripts/verify-packs.mjs [--keep]
// --keep leaves the temporary app in place; it is kept anyway when a step fails.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const repo = join(import.meta.dirname, '..');
// The create-next-app of the Next.js version the repository tests against.
const CREATE_NEXT_APP = 'create-next-app@16.4.3';
const PNPM = 'pnpm@12.16.1';
const MOCK_PORT = 4111;
const APP_PORT = 3200;
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'askdare-verify-'));
const app = join(work, 'app');

// A clean environment for npm and Next.js: pnpm's own npm_config_* settings stay out of it.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('npm_config_')),
);
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: '1',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
});

function run(command, args, cwd) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} failed with exit code ${result.status}`);
  }
}

function start(command, args, cwd, extra = {}) {
  const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: 'pipe' });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  return { child, output: () => output };
}

async function stop(process) {
  if (!process || process.child.exitCode !== null) return;
  process.child.kill();
  await once(process.child, 'exit');
}

async function waitFor(url, what) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  throw new Error(`${what} didn't start at ${url}`);
}

/** Opens the chat on the app's home page and sends one message. */
async function chat(browser, bundler) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${APP_PORT}/`);
  await page.locator('[part="launcher"]').click();
  const frame = page.frameLocator('iframe[title="Chat"]');
  const text = `Hello from a fresh app (${bundler})`;
  await frame.getByRole('textbox').fill(text);
  await frame.getByRole('textbox').press('Enter');
  await frame
    .locator('[data-ask-part="message"][data-role="assistant"]')
    .filter({ hasText: `You said: ${text}` })
    .waitFor({ timeout: 20_000 });
  await page.close();
  if (errors.length > 0) throw new Error(`Errors on the page: ${errors.join('; ')}`);
  console.log(`\n✓ The chat answers in the ${bundler} build.`);
}

let mock;
let server;
let browser;
let ok = false;
try {
  // 1. The packages, packed as npm would publish them (workspace: ranges become versions).
  run('npx', ['-y', PNPM, '--filter', './packages/*', 'run', 'build'], repo);
  for (const name of ['askdare', 'askdare-upstash']) {
    run('npx', ['-y', PNPM, 'pack', '--pack-destination', work], join(repo, 'packages', name));
  }
  const tarballs = readdirSync(work)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => join(work, file));

  // 2. A fresh Next.js app, as in Getting started.
  run(
    'npx',
    [
      '-y',
      CREATE_NEXT_APP,
      'app',
      '--ts',
      '--app',
      '--no-tailwind',
      '--no-eslint',
      '--no-src-dir',
      '--no-react-compiler',
      '--import-alias',
      '@/*',
      '--use-npm',
      '--disable-git',
      '--no-agent-feedback',
      '--skip-install',
      '--yes',
    ],
    work,
  );
  run('npm', ['install', ...tarballs, 'zod@^4.1.0', '@upstash/redis@^1.35.0'], app);

  // 3. What a user runs: init, then the values they would fill in (test values here).
  run(join(app, 'node_modules/.bin/askdare'), ['init', '--model', 'mock-model'], app);
  const envFile = join(app, '.env.local');
  const values = readFileSync(envFile, 'utf8').replace(
    /^OPENAI_API_KEY=$/m,
    'OPENAI_API_KEY=sk-verify-packs-not-a-real-key',
  );
  writeFileSync(envFile, `${values}OPENAI_BASE_URL=http://127.0.0.1:${MOCK_PORT}/v1\n`);
  run(
    'node',
    [
      '--input-type=module',
      '-e',
      "const { upstashStore } = await import('@boldare/askdare-upstash'); if (typeof upstashStore !== 'function') process.exit(1);",
    ],
    app,
  );

  // 4. Both bundlers: build, start, doctor and one message.
  mock = start('node', [join(repo, 'e2e/servers/mock-openai.mjs')], repo, {
    MOCK_OPENAI_PORT: String(MOCK_PORT),
  });
  await waitFor(`http://127.0.0.1:${MOCK_PORT}/health`, 'The mock OpenAI');
  browser = await chromium.launch();
  for (const bundler of ['Turbopack', 'webpack']) {
    rmSync(join(app, '.next'), { recursive: true, force: true });
    run(
      join(app, 'node_modules/.bin/next'),
      ['build', ...(bundler === 'webpack' ? ['--webpack'] : [])],
      app,
    );
    server = start(join(app, 'node_modules/.bin/next'), ['start', '--port', String(APP_PORT)], app);
    await waitFor(`http://localhost:${APP_PORT}/api/chat/widget.js?bot=support`, 'next start');
    run(
      join(app, 'node_modules/.bin/askdare'),
      ['doctor', '--url', `http://localhost:${APP_PORT}`],
      app,
    );
    await chat(browser, bundler);
    await stop(server);
    server = undefined;
  }
  ok = true;
  console.log('\nverify-packs: the packed packages install, build and chat in a fresh app.');
} catch (error) {
  console.error(`\nverify-packs failed: ${error instanceof Error ? error.message : error}`);
  if (server) console.error(`\nnext start said:\n${server.output().slice(-4000)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop(server);
  await stop(mock);
  if (ok && !keep) rmSync(work, { recursive: true, force: true });
  else console.log(`\nThe app is in ${app}`);
}
