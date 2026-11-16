// Records the shots of the one-click deploy video as screencast frames (issue #79).
//
//   pnpm --filter askdare-recording record [shot…]   scripted shots: home, deploy, chat
//   pnpm --filter askdare-recording record:vercel    you drive Vercel; frames are recorded
//
// APP_URL is the freshly deployed starter for the chat shot (default: the askdare demo).
// Frames land in out/<shot>/ with their timestamps; edit.mjs turns them into the video.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  async chat(page) {
    await page.goto(APP, { waitUntil: 'networkidle' });
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

async function vercel() {
  // A profile of its own, so you sign in to Vercel once and never in your daily browser.
  const ctx = await chromium.launchPersistentContext(join(HERE, '.profile'), {
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(overlay);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const deployUrl = (
    await readFile(join(HERE, '../../site/app/deploy/clone-url.ts'), 'utf8')
  ).match(/https:\/\/vercel\.com\/new\/clone\?[^'"`]+/)?.[0];
  await page.goto(deployUrl ?? 'https://vercel.com/new');
  console.log(
    '\nSign in to Vercel in the window that opened (that part is not recorded).\nThen press Enter here to start recording, fill the form with a throwaway key, click Deploy,\nwait for the build to finish, and press Enter again to stop.\n',
  );
  await waitForEnter();
  await page.goto(deployUrl ?? 'https://vercel.com/new');
  const stop = await screencast(page, 'vercel');
  console.log('Recording. Press Enter when the form is filled and you have clicked Deploy.');
  await caption(page, 'Paste the <b>key</b> and the <b>secret</b>, click <b>Deploy</b>');
  await waitForEnter();
  await caption(page, 'Vercel builds <b>your own copy</b>');
  speed(15);
  console.log('Press Enter once the build is done.');
  await waitForEnter();
  await stop();
  await ctx.close();
}

function waitForEnter() {
  return new Promise((r) => process.stdin.once('data', r));
}

if (process.argv.includes('--vercel')) {
  await vercel();
  process.exit(0);
}

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
