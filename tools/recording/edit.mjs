// Turns the recorded shots (out/<shot>/) into the deploy video: each shot in a browser window
// on an askdare backdrop, captions under the window, cross-fades, an end card.
//
//   pnpm --filter askdare-recording edit
//
// Writes site/public/deploy-flow.mp4, its poster and .github/assets/deploy-flow.gif.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { chromium } from '@playwright/test';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'out');
const WORK = join(OUT, 'edit');
const FFMPEG = ffmpegInstaller.path;

const W = 1280;
const H = 800;
const FPS = 30;
// The browser window: the page (recorded at 1280×800) is scaled to 1024×640 under a 36px bar.
const WIN = { x: 128, y: 30, w: 1024, h: 640, bar: 36 };
const XFADE = 0.4;

const APP_HOST = new URL(process.env.APP_URL ?? 'https://askdare-chat.vercel.app').host;

/**
 * The cut. `from`/`to` trim the shot (seconds from its start, `to` from its end when negative),
 * `speed` plays it faster (times the factors the recording marked). Shots without frames are skipped, so the cut works before Vercel is in.
 */
const CUT = [
  { shot: 'home', url: 'askdare.vercel.app', from: 0.4, to: -0.2, speed: 1.1 },
  { shot: 'deploy', url: 'askdare.vercel.app/deploy', from: 0.3, to: 0, speed: 1.15 },
  { shot: 'vercel', url: 'vercel.com/new', from: 0, to: 0, speed: 1.6 },
  { shot: 'chat', url: APP_HOST, from: 0.3, to: 0, speed: 1.25 },
];
const END_CARD = 2.6;

const ff = async (args) => {
  try {
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      maxBuffer: 1 << 26,
    });
  } catch (e) {
    throw new Error(`ffmpeg failed: ${e.stderr || e.message}\n${args.join(' ')}`);
  }
};

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// The site's typeface, embedded so the captions and the end card match the pages.
const fontFile = createRequire(import.meta.url).resolve(
  '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
);
const FONT_FACE = `<style>@font-face{font-family:'Jakarta';font-weight:200 800;src:url(data:font/woff2;base64,${(
  await readFile(fontFile)
).toString('base64')}) format('woff2')}</style>`;
const FONT = `font-family: 'Jakarta', system-ui, sans-serif;`;
const BACKDROP = `
  background:
    radial-gradient(60% 70% at 8% 0%, #ffd9ec 0%, transparent 60%),
    radial-gradient(55% 65% at 100% 100%, #d9dcff 0%, transparent 60%),
    radial-gradient(40% 50% at 85% 10%, #e3f7ef 0%, transparent 70%),
    #fbf8fc;`;

/** The backdrop with an empty browser window whose address bar shows `url`. */
const backdropHtml = (
  url,
) => `<!doctype html><html><head>${FONT_FACE}</head><body style="margin:0;width:${W}px;height:${H}px;${BACKDROP}${FONT}">
  <div style="position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h + WIN.bar}px;
    border-radius:14px;background:#fff;box-shadow:0 30px 60px -20px rgb(60 20 90 / .35),0 0 0 1px rgb(30 10 50 / .08);overflow:hidden">
    <div style="height:${WIN.bar}px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#f3f0f5;border-bottom:1px solid #e6e1ea">
      <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#febc2e"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#28c840"></span>
      <div style="margin:0 auto;transform:translateX(-30px);min-width:360px;padding:5px 14px;border-radius:8px;background:#fff;
        color:#4a4152;font-size:13px;text-align:center;box-shadow:inset 0 0 0 1px #e6e1ea">🔒 ${esc(url)}</div>
    </div>
  </div></body></html>`;

/** A caption pill, transparent around it, for the strip under the window. */
const captionHtml = (
  html,
) => `<!doctype html><html><head>${FONT_FACE}</head><body style="margin:0;width:${W}px;height:${H - (WIN.y + WIN.bar + WIN.h)}px;
  display:grid;place-items:center;background:transparent;${FONT}">
  <div style="padding:11px 24px;border-radius:999px;background:#17121c;color:#fff;font-size:21px;font-weight:600;letter-spacing:-.01em;
    box-shadow:0 10px 24px -10px rgb(23 18 28 / .6)">${html.replaceAll('<b>', '<b style="color:#ffd84d">')}</div></body></html>`;

const endCardHtml = `<!doctype html><html><head>${FONT_FACE}</head><body style="margin:0;width:${W}px;height:${H}px;${BACKDROP}${FONT}
  display:grid;place-items:center;text-align:center;color:#17121c">
  <div>
    <div style="font-size:22px;font-weight:600;color:#8a3fa0;letter-spacing:.02em">askdare by Boldare</div>
    <div style="margin-top:14px;font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.05">
      Your own AI chatbot<br><span style="background:linear-gradient(90deg,#c2306f,#6d4ce6);-webkit-background-clip:text;color:transparent">online in five minutes</span></div>
    <div style="margin-top:34px;display:inline-block;padding:14px 28px;border-radius:999px;color:#fff;font-size:24px;font-weight:700;
      background:linear-gradient(90deg,#c2306f,#6d4ce6);box-shadow:0 16px 30px -14px rgb(109 76 230 / .7)">askdare.vercel.app/deploy</div>
  </div></body></html>`;

async function renderPngs(jobs) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const { html, file, height = H } of jobs) {
    await page.setViewportSize({ width: W, height });
    await page.setContent(html);
    await page.screenshot({ path: file, omitBackground: true });
  }
  await browser.close();
}

/** Builds one shot's clip: frames → window on backdrop → captions. Returns its length. */
async function buildShot(cut, i) {
  const dir = join(OUT, cut.shot);
  const meta = JSON.parse(await readFile(join(dir, 'frames.json'), 'utf8'));
  const { frames, end } = meta;
  const t0 = frames[0].t;
  const total = end - t0;
  const from = cut.from;
  const to = cut.to > 0 ? cut.to : total + cut.to;

  // The concat demuxer plays each frame for as long as it was on screen.
  const list = frames
    .map((f, k) => {
      const next = k + 1 < frames.length ? frames[k + 1].t : end;
      return `file '${join(dir, f.file)}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
    })
    .join('\n');
  const listFile = join(WORK, `${cut.shot}.txt`);
  await writeFile(listFile, `${list}\nfile '${join(dir, frames.at(-1).file)}'\n`);

  // Speed: the base factor times the factors marked while recording, piece by piece.
  const caps = (meta.captions ?? []).map((c) => ({ ...c, s: c.t - t0 }));
  const pieces = [{ s: from, v: cut.speed }];
  for (const m of meta.speeds ?? []) {
    const s = m.t - t0;
    if (s > from && s < to) pieces.push({ s, v: cut.speed * m.factor });
  }
  let acc = 0;
  for (const [k, p] of pieces.entries()) {
    p.c = acc;
    const next = pieces[k + 1]?.s ?? to;
    acc += (next - p.s) / p.v;
  }
  const mapTime = (s) => {
    const x = Math.min(Math.max(s, from), to);
    const p = pieces.findLast((q) => q.s <= x);
    return p.c + (x - p.s) / p.v;
  };
  const length = mapTime(to);
  // setpts runs after trim; T is still seconds from the shot's start.
  const pts = pieces.reduceRight((rest, p, k) => {
    const here = `${p.c.toFixed(4)}+(T-${p.s.toFixed(4)})/${p.v}`;
    return k === pieces.length - 1
      ? here
      : `if(lt(T,${pieces[k + 1].s.toFixed(4)}),${here},${rest})`;
  }, '');

  const backdrop = join(WORK, `${cut.shot}-backdrop.png`);
  const capFiles = caps.map((_, k) => join(WORK, `${cut.shot}-cap${k}.png`));
  await renderPngs([
    { html: backdropHtml(cut.url), file: backdrop },
    ...caps.map((c, k) => ({
      html: captionHtml(c.html),
      file: capFiles[k],
      height: H - (WIN.y + WIN.bar + WIN.h),
    })),
  ]);

  const inputs = ['-f', 'concat', '-safe', '0', '-i', listFile, '-loop', '1', '-i', backdrop];
  for (const f of capFiles) inputs.push('-loop', '1', '-i', f);
  const capY = WIN.y + WIN.bar + WIN.h;
  let graph =
    `[0:v]fps=${FPS * 2},trim=start=${from}:end=${to},setpts='(${pts})/TB',fps=${FPS},` +
    `scale=${WIN.w}:${WIN.h}:flags=lanczos,format=yuv420p[page];` +
    `[1:v]format=yuv420p[bg];[bg][page]overlay=${WIN.x}:${WIN.y + WIN.bar}:shortest=1[v0]`;
  let last = 'v0';
  caps.forEach((c, k) => {
    const start = Math.max(0, mapTime(c.s));
    const stop = caps[k + 1] ? mapTime(caps[k + 1].s) : length;
    graph +=
      `;[${k + 2}:v]format=rgba,fade=in:st=${start.toFixed(2)}:d=0.25:alpha=1,` +
      `fade=out:st=${Math.max(start, stop - 0.25).toFixed(2)}:d=0.25:alpha=1[c${k}]` +
      `;[${last}][c${k}]overlay=0:${capY}:enable='between(t,${start.toFixed(2)},${stop.toFixed(2)})'[v${k + 1}]`;
    last = `v${k + 1}`;
  });
  const clip = join(WORK, `${i}-${cut.shot}.mp4`);
  await ff([
    ...inputs,
    '-filter_complex',
    graph,
    '-map',
    `[${last}]`,
    '-t',
    length.toFixed(3),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-crf',
    '14',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    clip,
  ]);
  console.log(`${cut.shot}: ${length.toFixed(1)}s`);
  return { clip, length };
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

const clips = [];
for (const [i, cut] of CUT.entries()) {
  if (!existsSync(join(OUT, cut.shot, 'frames.json'))) {
    console.log(`${cut.shot}: not recorded, skipped`);
    continue;
  }
  clips.push(await buildShot(cut, i));
}

const endPng = join(WORK, 'end.png');
await renderPngs([{ html: endCardHtml, file: endPng }]);
const endClip = join(WORK, '9-end.mp4');
await ff([
  '-loop',
  '1',
  '-i',
  endPng,
  '-t',
  String(END_CARD),
  '-r',
  String(FPS),
  '-vf',
  'format=yuv420p',
  '-c:v',
  'libx264',
  '-crf',
  '14',
  '-pix_fmt',
  'yuv420p',
  endClip,
]);
clips.push({ clip: endClip, length: END_CARD });

// Cross-fade the clips into one.
const inputs = clips.flatMap((c) => ['-i', c.clip]);
let graph = '';
let offset = 0;
let prev = '0:v';
for (let k = 1; k < clips.length; k++) {
  offset += clips[k - 1].length - XFADE;
  const out = k === clips.length - 1 ? 'out' : `x${k}`;
  graph += `${graph ? ';' : ''}[${prev}][${k}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(3)}[${out}]`;
  prev = out;
}
const master = join(WORK, 'master.mp4');
await ff([
  ...inputs,
  '-filter_complex',
  graph,
  '-map',
  '[out]',
  '-c:v',
  'libx264',
  '-crf',
  '12',
  '-pix_fmt',
  'yuv420p',
  master,
]);

// The site's video: small H.264 that starts at once (faststart), plus a poster from the end card.
const mp4 = join(ROOT, 'site/public/deploy-flow.mp4');
const poster = join(ROOT, 'site/public/deploy-flow.jpg');
await ff([
  '-i',
  master,
  '-c:v',
  'libx264',
  '-preset',
  'veryslow',
  '-crf',
  process.env.CRF ?? '30',
  '-tune',
  'animation',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  '-an',
  mp4,
]);
await ff(['-sseof', '-1', '-i', master, '-frames:v', '1', '-q:v', '4', poster]);

// The README's GIF: smaller and slower, one palette for the whole clip.
const gif = join(ROOT, '.github/assets/deploy-flow.gif');
const gifFilter = `fps=${process.env.GIF_FPS ?? 10},scale=${process.env.GIF_WIDTH ?? 800}:-1:flags=lanczos`;
const palette = join(WORK, 'palette.png');
await ff(['-i', master, '-vf', `${gifFilter},palettegen=max_colors=128:stats_mode=diff`, palette]);
await ff([
  '-i',
  master,
  '-i',
  palette,
  '-lavfi',
  `${gifFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  gif,
]);

const total = clips.reduce((s, c) => s + c.length, 0) - XFADE * (clips.length - 1);
const kb = async (f) => `${Math.round((await stat(f)).size / 1024)} KB`;
console.log(
  `\n${total.toFixed(1)}s · mp4 ${await kb(mp4)} · gif ${await kb(gif)} · poster ${await kb(poster)}`,
);
