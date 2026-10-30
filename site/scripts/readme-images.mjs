// Renders the README's pictures to .github/assets/, and the site's social card to
// app/opengraph-image.png, from the real chat: the state gallery's fixtures, captured in English,
// laid out in the site's Aura look. Run it with the site's dev server up and the gallery on
// (ASKDARE_GALLERY=1, as in .claude/launch.json):
//   node site/scripts/readme-images.mjs [http://localhost:3000]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { codeToHtml } from 'shiki';

const origin = process.argv[2] ?? 'http://localhost:3000';
const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(site, '..', '.github', 'assets');

const uri = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const file = async (path, type) => uri(await readFile(join(site, path)), type);
const font = (name) =>
  file(
    `node_modules/@fontsource-variable/${name}/files/${name}-latin-wght-normal.woff2`,
    'font/woff2',
  );

const browser = await chromium.launch();
const context = {
  locale: 'en-US',
  deviceScaleFactor: 2,
  reducedMotion: /** @type {const} */ ('reduce'),
};

/**
 * One state of the chat from the gallery, as a PNG data URI. `part` or `clip` takes a piece of it,
 * on a transparent background (the page's glow is the body's).
 */
async function chat({
  bot = 'support',
  state,
  preset,
  scheme = 'light',
  height = 640,
  top,
  part,
  clip,
}) {
  const page = await browser.newPage({ ...context, viewport: { width: 400, height } });
  const query = new URLSearchParams({ gallery: state, ...(preset ? { preset, scheme } : {}) });
  await page.goto(`${origin}/api/chat/embed/${bot}?${query}`);
  await page.locator('[data-ask-part="panel"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (top) {
    await page.evaluate(() => {
      const messages = document.querySelector('[data-ask-part="messages"]');
      if (messages) messages.scrollTop = 0;
    });
  }
  // The embed's CSP allows no inline <style>; CSSOM changes are fine.
  if (part || clip) {
    await page.evaluate(() =>
      document.body.style.setProperty('background', 'transparent', 'important'),
    );
  }
  await page.waitForTimeout(400);
  let png;
  if (part) png = await page.locator(part).first().screenshot({ omitBackground: true });
  else if (clip)
    png = await page.screenshot({ clip: await page.evaluate(clip), omitBackground: true });
  else png = await page.screenshot();
  await page.close();
  return uri(png, 'image/png');
}

/**
 * From the home page: the real launcher, with room for its shadow, on a transparent background,
 * and the themes' flat shape icons from the dock, as SVG markup.
 */
async function homePage() {
  const page = await browser.newPage({ ...context, viewport: { width: 1280, height: 800 } });
  await page.goto(`${origin}/?theme=aura&mode=bubble`);
  const icons = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.dock-theme')].map((link) => [
        new URL(link.href).searchParams.get('theme'),
        link.querySelector('svg').outerHTML,
      ]),
    ),
  );
  const button = page.locator('[part="launcher"]');
  await button.waitFor();
  await page.addStyleTag({
    content: `html, body, .demo { background: transparent !important; }
      body > *:not([data-askdare]) { visibility: hidden !important; }`,
  });
  await page.waitForTimeout(400);
  const box = await button.boundingBox();
  const pad = 28;
  const png = await page.screenshot({
    omitBackground: true,
    clip: {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + 2 * pad,
      height: box.height + 2 * pad,
    },
  });
  await page.close();
  return { launcher: uri(png, 'image/png'), icons };
}

const code = (source, lang) =>
  codeToHtml(source, { lang, theme: 'catppuccin-mocha' }).then((html) =>
    html.replace(/ style="[^"]*"/, ''),
  );

// ---------- What goes in ----------

const jakarta = await font('plus-jakarta-sans');
const logo = await file('public/boldare-logo.svg', 'image/svg+xml');
const home = await homePage();
const shots = {
  conversation: await chat({ state: 'conversation', preset: 'aura', height: 660, top: true }),
  welcome: await chat({ state: 'welcome', preset: 'aura' }),
  answer: await chat({
    state: 'conversation',
    preset: 'aura',
    height: 900,
    top: true,
    part: '[data-ask-part="message"][data-role="assistant"]',
  }),
  // The files waiting to be sent: a PDF, an image uploading, a type the chat refuses.
  attachments: await chat({
    state: 'attachments',
    preset: 'aura',
    clip: () => {
      const boxes = [...document.querySelectorAll('[data-ask-part="attachment"][data-status]')].map(
        (element) => element.getBoundingClientRect(),
      );
      const top = Math.min(...boxes.map((box) => box.top)) - 8;
      const bottom = Math.max(...boxes.map((box) => box.bottom)) + 2;
      const right = Math.max(...boxes.map((box) => box.right)) + 10;
      return { x: 0, y: top, width: Math.min(400, right), height: bottom - top };
    },
  }),
  recorder: await chat({
    state: 'listening',
    preset: 'aura',
    part: '[data-ask-part="composer-box"]',
  }),
  themes: [
    {
      id: 'halo',
      name: 'Halo',
      note: 'light',
      src: await chat({ state: 'welcome', preset: 'halo' }),
    },
    {
      id: 'aura',
      name: 'Aura',
      note: 'dark',
      src: await chat({ state: 'welcome', preset: 'aura', scheme: 'dark' }),
    },
    {
      id: 'sage',
      name: 'Sage',
      note: 'light',
      src: await chat({ state: 'welcome', preset: 'sage' }),
    },
    {
      id: 'care',
      name: 'Care',
      note: 'light',
      src: await chat({ state: 'welcome', preset: 'care' }),
    },
    {
      id: 'bldr',
      name: 'BLDR',
      note: 'your own',
      src: await chat({ bot: 'bldr', state: 'welcome' }),
    },
  ],
};
const toolCode = await code(
  `defineTool({
  name: 'get_order_status',
  input: z.object({ id: z.string() }),
  execute: ({ id }) => shop.order(id),
})`,
  'ts',
);

// ---------- The look: the site's Aura theme ----------

const base = `
  @font-face { font-family: Jakarta; src: url(${jakarta}) format('woff2'); font-weight: 200 800; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: transparent; }
  body {
    color: #242424; font-family: Jakarta, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .poster {
    position: relative; overflow: hidden; border-radius: 32px;
    background-color: #fdfbfd;
    background-image:
      radial-gradient(50% 60% at 0% 0%, #ffd9e6 0%, #ffd9e600 70%),
      radial-gradient(46% 56% at 100% 4%, #e2dbff 0%, #e2dbff00 70%),
      radial-gradient(50% 40% at 62% 100%, #d2f3ec 0%, #d2f3ec00 70%);
    box-shadow: inset 0 0 0 1px #24242414;
  }
  .flat { border-radius: 0; box-shadow: none; }
  .dots {
    position: absolute; inset: 0;
    background-image: radial-gradient(#24242422 1px, transparent 1.4px);
    background-size: 18px 18px;
    -webkit-mask-image: radial-gradient(40% 55% at 78% 46%, #000 0%, transparent 100%);
  }
  h1, h2 { font-weight: 500; letter-spacing: -0.035em; line-height: 1.04; }
  h1 span, h2 span { color: #857f8d; }
  h1 strong, h2 strong { font-weight: 800; }
  .eyebrow {
    display: inline-block; margin-bottom: 14px; color: #a3285a;
    font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  }
  .lockup { display: flex; align-items: center; gap: 16px; }
  .lockup img { height: 16px; }
  .product {
    display: grid; padding-left: 16px; border-left: 1px solid #2424241a;
    font-size: 18px; font-weight: 700; line-height: 1.15; letter-spacing: -0.01em;
  }
  .product small, .gradient {
    width: fit-content; background: linear-gradient(115deg, #c2386f, #6b52e0);
    -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 700;
  }
  .product small { margin-top: 2px; font-size: 14px; }
  .frame {
    overflow: hidden; border-radius: 24px; background: #fff;
    box-shadow: 0 48px 90px -40px #3b1d5a73, 0 18px 36px -24px #3b1d5a40, 0 0 0 1px #24242412;
  }
  .frame img { display: block; width: 100%; }
  .card {
    border: 1px solid #2424241a; border-radius: 24px; background: #ffffffb8;
    box-shadow: 0 30px 60px -44px #3b1d5a66; backdrop-filter: blur(8px);
  }
  .term {
    border-radius: 14px; background: #1e1b26; color: #e8e3ef;
    font: 500 14px/1.6 "SF Mono", ui-monospace, Menlo, monospace; white-space: pre;
  }
  .term .p { color: #8f879c; }
  .term .t { color: #f5a3c7; } .term .a { color: #cdb8ff; } .term .s { color: #a6e3c8; }
  .shiki { background: transparent !important; font: 500 13.5px/1.65 "SF Mono", ui-monospace, Menlo, monospace; }
  .tags { display: flex; gap: 8px; list-style: none; }
  .tags li {
    padding: 6px 13px; border: 1px solid #2424241a; border-radius: 999px; background: #ffffffb8;
    color: #5f5a68; font-size: 13.5px; font-weight: 600;
  }
`;

const hero = (flat = false) => `
  <style>
    .hero { width: 1280px; height: 640px; }
    .hero .copy { position: absolute; top: 60px; left: 72px; width: 640px; }
    .hero h1 { margin-top: 64px; font-size: 64px; }
    .hero .lead { max-width: 33em; margin: 26px 0 30px; color: #5f5a68; font-size: 19px; line-height: 1.6; }
    .hero .term { display: inline-block; padding: 14px 20px; font-size: 15px; }
    .hero .tags { margin-top: 22px; }
    .hero .orb {
      position: absolute; top: 250px; left: 712px; width: 240px; height: 240px; border-radius: 50%;
      background:
        radial-gradient(circle at 33% 24%, #ffffff 0%, #ffffffd9 6%, #ffffff00 19%),
        radial-gradient(circle at 70% 84%, #9df3e6 0%, #9df3e600 44%),
        radial-gradient(circle at 50% 28%, #ffa3c6 0%, #f28bbb 24%, #b8a1f6 60%, #7dd8d0 100%);
      box-shadow: 0 50px 70px -30px #b8a1f6a6, inset -18px -24px 40px #6b52e040;
    }
    .hero .orb-glow {
      position: absolute; top: 200px; left: 662px; width: 340px; height: 340px; border-radius: 50%;
      background: radial-gradient(closest-side, #f28bbb40, #b8a1f620 60%, transparent);
      filter: blur(10px);
    }
    .hero .frame { position: absolute; top: 44px; right: 96px; width: 340px; }
  </style>
  <div class="poster hero${flat ? ' flat' : ''}">
    <div class="dots"></div>
    <div class="orb-glow"></div><div class="orb"></div>
    <div class="copy">
      <div class="lockup"><img src="${logo}" alt=""><span class="product">askdare<small>Dare to ask.</small></span></div>
      <h1><span>An</span> <strong>AI assistant</strong><br><span>for any website,</span><br><strong>in one script tag</strong></h1>
      <p class="lead">An open-source Next.js library on the OpenAI API. It answers from your documents, calls your tools and fits your brand, with security built in.</p>
      <div class="term"><span class="p">$</span> npm install @boldare/askdare</div>
      <ul class="tags"><li>Next.js 16</li><li>OpenAI Responses API</li><li>Open source, MIT</li></ul>
    </div>
    <div class="frame"><img src="${shots.conversation}" alt=""></div>
  </div>`;

const how = () => `
  <style>
    .how { width: 1280px; height: 640px; }
    .how .copy { position: absolute; top: 50px; left: 72px; width: 600px; }
    .how h2 { font-size: 46px; }
    .how ol { display: grid; gap: 18px; margin-top: 28px; list-style: none; }
    .how li { display: grid; grid-template-columns: 44px 1fr; gap: 4px 14px; }
    .how .num {
      display: grid; place-items: center; width: 36px; height: 36px; border-radius: 999px;
      background: linear-gradient(115deg, #c2386f, #6b52e0); color: #fff; font-size: 13px; font-weight: 800;
    }
    .how h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.01em; line-height: 36px; }
    .how li p { grid-column: 2; margin-top: -6px; color: #5f5a68; font-size: 15px; line-height: 1.5; }
    .how .term { grid-column: 2; justify-self: start; margin-top: 8px; padding: 10px 16px; font-size: 13.5px; }
    .browser { position: absolute; top: 56px; right: 64px; width: 500px; height: 528px; overflow: hidden; }
    .bar { display: flex; align-items: center; gap: 7px; height: 42px; padding: 0 16px; border-bottom: 1px solid #2424241a; }
    .bar i { width: 11px; height: 11px; border-radius: 99px; background: #24242426; }
    .bar span {
      margin-left: 14px; padding: 5px 14px; border-radius: 99px; background: #2424240d;
      color: #5f5a68; font-size: 12px; font-weight: 600;
    }
    .site { padding: 30px 28px; }
    .site b { display: block; height: 12px; margin-bottom: 12px; border-radius: 6px; background: #2424241a; }
    .site .h { width: 62%; height: 22px; background: #24242433; }
    .site .img { height: 150px; margin-top: 26px; border-radius: 16px; background: linear-gradient(135deg, #f1e9f6, #e6f4ef); }
    .browser .frame { position: absolute; right: 22px; bottom: 82px; width: 236px; border-radius: 18px; }
    .browser .launch { position: absolute; right: 2px; bottom: 6px; width: 200px; }
  </style>
  <div class="poster how">
    <div class="copy">
      <p class="eyebrow">How it works</p>
      <h2><span>From zero to a working chat</span><br><strong>in three steps</strong></h2>
      <ol>
        <li><span class="num">01</span><h3>Install</h3><p>Add the library and zod to your Next.js app.</p>
          <div class="term"><span class="p">$</span> npm install @boldare/askdare zod</div></li>
        <li><span class="num">02</span><h3>Set up</h3><p>init writes the chat route, a bot to start from and the environment template.</p>
          <div class="term"><span class="p">$</span> npx @boldare/askdare init</div></li>
        <li><span class="num">03</span><h3>Embed</h3><p>Paste one tag on any website. The chat is served from your app.</p>
          <div class="term"><span class="t">&lt;script</span> <span class="a">src</span>=<span class="s">"https://your-app.com/api/chat/widget.js?bot=support"</span>
  <span class="a">async</span><span class="t">&gt;&lt;/script&gt;</span></div></li>
      </ol>
    </div>
    <div class="browser card">
      <div class="bar"><i></i><i></i><i></i><span>www.your-website.com</span></div>
      <div class="site"><b class="h"></b><b style="width: 88%"></b><b style="width: 74%"></b><div class="img"></div>
        <b style="width: 40%; margin-top: 26px"></b><b style="width: 80%"></b></div>
      <div class="frame"><img src="${shots.welcome}" alt=""></div>
      <img class="launch" src="${home.launcher}" alt="">
    </div>
  </div>`;

const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>';
const features = () => `
  <style>
    .features { width: 1280px; height: 840px; padding: 56px 64px; }
    .features h2 { font-size: 44px; }
    .grid {
      display: grid; grid-template-columns: 372px 1fr 1fr; grid-template-rows: 1fr 1fr;
      gap: 20px; height: 546px; margin-top: 34px;
    }
    .tile { position: relative; overflow: hidden; padding: 24px 26px; }
    .tile h3 { font-size: 20px; font-weight: 800; letter-spacing: -0.015em; }
    .tile p { margin-top: 6px; color: #5f5a68; font-size: 14.5px; line-height: 1.5; }
    .kb { grid-row: span 2; }
    .kb img { position: absolute; left: 18px; bottom: 20px; width: 334px; }
    .tools .shiki {
      margin-top: 16px; padding: 14px 16px; border-radius: 14px; background: #1e1b26 !important;
      font-size: 12.5px;
    }
    .pic { position: absolute; left: 22px; bottom: 22px; }
    .files .pic { width: 300px; }
    .voice .pic { width: 318px; }
    .secure ul { display: grid; gap: 9px; margin-top: 14px; list-style: none; font-size: 14.5px; font-weight: 600; }
    .secure li { display: flex; align-items: center; gap: 10px; }
    .secure svg {
      flex: none; width: 20px; height: 20px; padding: 3px; border-radius: 99px; background: #d2f3ec;
      fill: none; stroke: #1c7a5e; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;
    }
    .strip { display: flex; align-items: center; gap: 10px; margin-top: 22px; }
    .strip strong { margin-right: 6px; font-size: 15px; }
    .strip .tags li { font-size: 13px; }
  </style>
  <div class="poster features">
    <p class="eyebrow">What it does</p>
    <h2><span>Everything a website chat needs,</span><br><strong>nothing it doesn't</strong></h2>
    <div class="grid">
      <div class="tile card kb"><h3>Answers from your documents</h3>
        <p>Upload a folder once with kb sync. Every answer cites its sources as links to your pages.</p>
        <img src="${shots.answer}" alt=""></div>
      <div class="tile card tools"><h3>Your own tools</h3>
        <p>Let it check an order or a price. Zod validates the arguments.</p>${toolCode}</div>
      <div class="tile card files"><h3>Images and PDFs</h3>
        <p>Visitors attach files; the server checks their type and size.</p>
        <img class="pic" src="${shots.attachments}" alt=""></div>
      <div class="tile card voice"><h3>Voice input</h3>
        <p>Visitors dictate. The transcript lands in the field for them to check.</p>
        <img class="pic" src="${shots.recorder}" alt=""></div>
      <div class="tile card secure"><h3>Secure by default</h3>
        <ul>
          <li>${check}Short-lived session tokens</li>
          <li>${check}Rate limits and daily token budgets</li>
          <li>${check}Only the sites you allow can embed it</li>
          <li>${check}Visitors never pick the model or tools</li>
        </ul></div>
    </div>
    <div class="strip"><strong>No database.</strong><ul class="tags">
      <li>Conversations live in OpenAI</li><li>Vercel or Heroku</li><li>Next.js 16</li><li>TypeScript</li><li>English and Polish</li>
    </ul></div>
  </div>`;

const themes = () => `
  <style>
    .themes { width: 1280px; height: 640px; padding-top: 52px; text-align: center; }
    .themes h2 { font-size: 46px; }
    .themes .lead { margin-top: 12px; color: #5f5a68; font-size: 17px; }
    .row { display: flex; justify-content: center; gap: 22px; margin-top: 40px; }
    .row figure { width: 212px; }
    .row .frame { border-radius: 18px; }
    .row figure:nth-child(1), .row figure:nth-child(5) { margin-top: 30px; }
    .row figure:nth-child(2), .row figure:nth-child(4) { margin-top: 12px; }
    figcaption { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 18px; font-size: 16px; font-weight: 800; }
    figcaption svg { width: 26px; height: 26px; }
    figcaption small { color: #857f8d; font-size: 13.5px; font-weight: 600; }
  </style>
  <div class="poster themes">
    <h2><span>Four themes,</span> <strong>light and dark</strong><span>, or</span> <strong>your own</strong></h2>
    <p class="lead">Pick a preset, set your colors, or restyle any part with your own CSS.</p>
    <div class="row">${shots.themes
      .map(
        (theme) => `<figure><div class="frame"><img src="${theme.src}" alt=""></div>
          <figcaption>${home.icons[theme.id]}${theme.name} <small>${theme.note}</small></figcaption></figure>`,
      )
      .join('')}</div>
  </div>`;

// ---------- Out ----------

async function render(html, { width, height, path, scale = 2 }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(
    `<!doctype html><html><head><style>${base}</style></head><body>${html}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await writeFile(path, await page.screenshot({ omitBackground: true }));
  await page.close();
  console.log(`  ${path}`);
}

await mkdir(assets, { recursive: true });
await render(hero(), { width: 1280, height: 640, path: join(assets, 'askdare-hero.png') });
await render(features(), { width: 1280, height: 840, path: join(assets, 'askdare-features.png') });
await render(how(), { width: 1280, height: 640, path: join(assets, 'askdare-how-it-works.png') });
await render(themes(), { width: 1280, height: 640, path: join(assets, 'askdare-themes.png') });
// The link preview: square corners, at the size it is shown.
await render(hero(true), {
  width: 1280,
  height: 640,
  path: join(site, 'app', 'opengraph-image.png'),
  scale: 1,
});
await browser.close();
