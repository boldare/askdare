// Records the shots of the one-click deploy video as screencast frames (issue #79).
//
//   pnpm --filter askdare-recording record [shot…]   scripted shots: home, deploy, chat
//   pnpm --filter askdare-recording record:vercel    the whole flow on Vercel: you sign in,
//                                                    paste the key and the secret, and click
//                                                    Deploy; it records, then films the chat on
//                                                    the new app and runs the edit
//
// APP_URL is the freshly deployed starter for the chat shot (default: the askdare demo).
// Frames land in out/<shot>/ with their timestamps; edit.mjs turns them into the video.
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const SITE = process.env.SITE_URL ?? 'https://askdare.vercel.app';
const APP = process.env.APP_URL ?? SITE;
const QUESTION = process.env.QUESTION ?? 'What can you help me with?';
const VIEWPORT = { width: 1280, height: 800 };
const overlay = await readFile(join(HERE, 'overlay.js'), 'utf8');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Captions of the shot being recorded, with their start times; edit.mjs draws them. */
let marks = [];
/** Playback speeds from a moment on (waiting is sped up in the edit). */
let speeds = [];

/** Records every painted frame of `page` (JPEG, 2x) until the returned stop() is called. */
async function screencast(page, shot) {
  const dir = join(OUT, shot);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  marks = [];
  speeds = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: metadata.timestamp });
    writes.push(writeFile(join(dir, file), Buffer.from(data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: VIEWPORT.width * 2,
    maxHeight: VIEWPORT.height * 2,
  });
  return async () => {
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(writes);
    await writeFile(
      join(dir, 'frames.json'),
      JSON.stringify({ frames, end, captions: marks, speeds }, null, 1),
    );
    console.log(`${shot}: ${frames.length} frames`);
  };
}

/** Glides the drawn pointer to an element's centre, then clicks it there. */
async function clickOn(page, locator, { ms = 800, click = true } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Not visible: ${locator}`);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate(([x, y, ms]) => window.__rec.moveTo(x, y, ms), [x, y, ms]);
  await pause(150);
  if (click) await page.mouse.click(x, y, { delay: 90 });
}

/** Starts a caption under the window from now on (null ends it). */
const caption = (_page, html) => marks.push({ t: Date.now() / 1000, html });
/** From now on, the edit plays the shot `factor` times faster than its base speed. */
const speed = (factor) => speeds.push({ t: Date.now() / 1000, factor });

async function smoothScroll(page, y, ms = 900) {
  await page.evaluate(
    ([y, ms]) =>
      new Promise((done) => {
        const from = scrollY;
        const start = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - start) / ms);
          const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
          scrollTo(0, from + (y - from) * e);
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [y, ms],
  );
}

const SHOTS = {
  /** The home page hero, then the click to /deploy. */
  async home(page) {
    await page.goto(SITE, { waitUntil: 'networkidle' });
    const stop = await screencast(page, 'home');
    await pause(600);
    await caption(page, 'One click from <b>askdare.vercel.app</b>');
    await pause(900);
    await clickOn(page, page.getByRole('link', { name: 'Your chatbot in 5 minutes' }));
    await page.waitForURL('**/deploy');
    await page.waitForLoadState('networkidle');
    await pause(500);
    await stop();
  },

  /** /deploy: the three steps, copying the (blurred) secret, the Deploy button. */
  async deploy(page) {
    await page.goto(`${SITE}/deploy`, { waitUntil: 'networkidle' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
    const stop = await screencast(page, 'deploy');
    await pause(500);
    const steps = page.getByRole('list', { name: 'Three steps' });
    const top = await steps.evaluate((el) => el.getBoundingClientRect().top + scrollY - 140);
    await smoothScroll(page, top);
    await caption(page, 'Bring your <b>OpenAI key</b>. The <b>CHAT_SECRET</b> is made for you');
    await pause(700);
    await clickOn(page, page.getByRole('button', { name: 'Copy' }));
    await pause(900);
    await caption(page, 'Then one click: <b>Deploy to Vercel</b>');
    await clickOn(page, page.getByRole('link', { name: 'Deploy to Vercel' }), { click: false });
    await page.evaluate(() => window.__rec.ripple());
    await pause(700);
    await stop();
  },

  /** The new app: open the chat, ask, and watch the answer stream in. */
  async chat(page, url = APP) {
    await page.goto(url, { waitUntil: 'networkidle' });
    const stop = await screencast(page, 'chat');
    await pause(500);
    await caption(page, 'Minutes later, <b>your chat is live</b>');
    await pause(500);
    await clickOn(page, page.locator('[part="launcher"]'));
    const t = Date.now();
    speed(6);
    const chat = page.frameLocator('iframe[title="Chat"]');
    const input = chat.locator('[data-ask-part="input"]');
    await input.waitFor();
    await chat.locator('[data-ask-part="greeting"], [data-ask-part="welcome"]').first().waitFor();
    await pause(400);
    console.log(`chat ready after ${Date.now() - t} ms`);
    speed(1);
    await pause(500);
    await input.pressSequentially(QUESTION, { delay: 45 });
    await pause(250);
    await input.press('Enter');
    speed(5);
    const answer = chat.locator('[data-ask-part="message"][data-role="assistant"]').last();
    const error = chat.locator('[data-ask-part="error"]');
    await Promise.race([
      answer.waitFor(),
      error.waitFor().then(async () => {
        throw new Error(`The chat answered with an error: ${await error.innerText()}`);
      }),
    ]);
    await chat
      .locator('[data-ask-part="message"][data-role="assistant"] [data-ask-part="bubble"]')
      .last()
      .waitFor();
    speed(2);
    // Done when the text stops changing for a second (and the options, if any, are in).
    let last = '';
    const busy = chat.locator('[data-ask-part="typing"]');
    for (let quiet = 0; quiet < 4 || (await busy.count()) > 0; ) {
      await pause(250);
      const now = await answer.innerText().catch(() => '');
      quiet = now && now === last ? quiet + 1 : 0;
      last = now;
    }
    speed(1);
    await pause(1800);
    await stop();
  },
};

const lines = createInterface({ input: process.stdin });
/** Resolves with `fallback` when you press Enter, unless `detect` settles first. */
function untilEnterOr(detect, fallback = 'enter') {
  let off;
  const enter = new Promise((r) => {
    const on = (line) => r(line.trim() || fallback);
    lines.once('line', on);
    off = () => lines.off('line', on);
  });
  return Promise.race([enter, detect]).finally(off);
}

/** Polls `fn` until it returns a truthy value (or forever; Enter is the way out). */
async function poll(fn, every = 500) {
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await pause(every);
  }
}

const say = (text) => console.log(`\n▶ ${text}`);

/**
 * The value field next to an environment variable's name, marked so it can be focused.
 * Vercel's form isn't ours, so this guesses: the first text field after the name in the page.
 */
async function markValueField(page, name) {
  return page.evaluate((name) => {
    const fields = [...document.querySelectorAll('input, textarea')].filter(
      (f) => !['checkbox', 'radio', 'hidden', 'button', 'submit'].includes(f.type),
    );
    const isName = (el) => ('value' in el && el.value === name) || el.textContent?.trim() === name;
    let anchor = fields.find(isName);
    if (!anchor) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (el.children.length === 0 && el.textContent?.trim() === name) {
          anchor = el;
          break;
        }
      }
    }
    if (!anchor) return false;
    const field = fields.find(
      (f) => f !== anchor && anchor.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (!field) return false;
    for (const f of document.querySelectorAll(`[data-rec-field="${name}"]`))
      f.removeAttribute('data-rec-field');
    field.setAttribute('data-rec-field', name);
    return true;
  }, name);
}

/** Glides to a variable's value field and focuses it, then waits for your paste. */
async function pasteInto(page, name) {
  const found = await markValueField(page, name).catch(() => false);
  if (found) {
    const field = page.locator(`[data-rec-field="${name}"]`);
    await clickOn(page, field, { ms: 900 });
    say(`Paste ${name} (Cmd+V) into the focused field in the browser.`);
    await untilEnterOr(poll(async () => (await field.evaluate((f) => f.value.length)) >= 20));
  } else {
    say(`Click the value field of ${name}, paste it (Cmd+V), then press Enter here.`);
    await untilEnterOr(new Promise(() => {}));
  }
  await pause(600);
}

async function vercel() {
  const deployUrl = (
    await readFile(join(HERE, '../../site/app/deploy/clone-url.ts'), 'utf8')
  ).match(/https:\/\/vercel\.com\/new\/clone\?[^'"`]+/)?.[0];
  if (!deployUrl) throw new Error('No Vercel clone URL in site/app/deploy/clone-url.ts');

  // A profile of its own, so you sign in to Vercel here and never in your daily browser.
  const ctx = await chromium.launchPersistentContext(join(HERE, '.profile'), {
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'en-US',
  });
  await ctx.addInitScript(overlay);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(deployUrl);

  // 1. Sign-in, not recorded: wait until the form names the variables.
  say(
    'Sign in to Vercel in the browser window (not recorded). If Vercel asks to create the repository first, do that too.\n  Recording starts by itself when the form with OPENAI_API_KEY shows (or press Enter).',
  );
  const form = page.getByText('OPENAI_API_KEY', { exact: true }).first();
  await untilEnterOr(form.waitFor({ timeout: 0 }));
  await page.waitForLoadState('networkidle').catch(() => {});
  await pause(800);

  // 2. The form, recorded: you paste the two values, the script does the rest of the moving.
  const stop = await screencast(page, 'vercel');
  await caption(page, 'Paste the <b>key</b> and the <b>secret</b>');
  await pause(800);
  await pasteInto(page, 'OPENAI_API_KEY');
  await pasteInto(page, 'CHAT_SECRET');

  // 3. Deploy: point at the button, you click it.
  await caption(page, 'Then <b>Deploy</b>');
  const deploy = page.getByRole('button', { name: /^deploy$/i }).last();
  if (await deploy.isVisible().catch(() => false)) {
    await clickOn(page, deploy, { click: false, ms: 900 });
  }
  say(
    'Click Deploy in the browser. (That creates the repository and the project on your account.)',
  );
  const startUrl = page.url();
  await untilEnterOr(
    poll(
      async () =>
        page.url() !== startUrl ||
        (await page
          .getByText(/building|deploying|queued/i)
          .first()
          .isVisible()),
    ),
  );

  // 4. The build, sped up in the edit.
  await caption(page, 'Vercel builds <b>your own copy</b>');
  speed(15);
  say('Building. Waiting for Vercel to finish (or press Enter when it has).');
  await untilEnterOr(
    poll(
      async () =>
        page
          .getByText(/congratulations|your project has been deployed/i)
          .first()
          .isVisible(),
      1000,
    ),
  );
  speed(1);
  await caption(page, 'Done. <b>Your app is live</b>');
  await pause(2500);
  await stop();

  // 5. The new app: find its address on the success page, or ask for it.
  let app = await page
    .evaluate(() =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .find((h) => /^https:\/\/[^/]+\.vercel\.app\/?$/.test(h) && !h.includes('//vercel.app')),
    )
    .catch(() => null);
  if (!app) {
    say('Paste the address of your new app (https://….vercel.app) and press Enter:');
    app = await untilEnterOr(new Promise(() => {}), '');
  }
  app = app.trim().replace(/\/$/, '');
  say(`Recording the chat on ${app}`);
  const chatPage = await ctx.newPage();
  await chatPage.bringToFront();
  await SHOTS.chat(chatPage, app);
  await ctx.close();
  lines.close();

  // 6. The edit.
  say('Editing the video…');
  await new Promise((resolve, reject) =>
    spawn(process.execPath, [join(HERE, 'edit.mjs')], {
      stdio: 'inherit',
      env: { ...process.env, APP_URL: app },
    }).on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`edit exited with ${code}`)),
    ),
  );
  say(`All done. Tell Claude the recording is ready, and revoke the OpenAI key you pasted.`);
}

if (process.argv.includes('--vercel')) {
  await vercel();
  process.exit(0);
}
lines.close();

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const browser = await chromium.launch();
for (const name of wanted.length ? wanted : Object.keys(SHOTS)) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    locale: 'en-US',
    reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(overlay);
  const page = await ctx.newPage();
  await SHOTS[name](page);
  await ctx.close();
}
await browser.close();
