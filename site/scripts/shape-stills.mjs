// Renders each theme's hero shape, settled, to public/shapes/<theme>.webp: what phones and
// reduced motion show instead of the 3D scene. Run it with the site's dev server up:
//   node site/scripts/shape-stills.mjs [http://localhost:3000]
// The page's clock is frozen and stepped, so the pose is the same on every machine.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const origin = process.argv[2] ?? 'http://localhost:3000';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shapes');
const THEMES = ['aura', 'sage', 'halo', 'care', 'bldr'];
/** Seconds after the shape starts: grown, settled, and turned to a good side. */
const POSE = 4.2;

await mkdir(out, { recursive: true });
// Software WebGL: the same pixels on any machine, GPU or not.
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const theme of THEMES) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  // The chat is not part of the picture.
  await page.route('**/widget.js*', (route) => route.abort());
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.goto(`${origin}/?theme=${theme}&mode=bubble`);
  const canvas = page.locator('.shape canvas');
  await canvas.waitFor();
  // The scene is up once the renderer has sized the canvas.
  await page.waitForFunction(() => document.querySelector('.shape canvas')?.width !== 300);
  await page.clock.runFor(POSE * 1000);
  // Only the shape, on a transparent background.
  await page.addStyleTag({
    content: `html, body, .demo { background: transparent !important; }
      body * { visibility: hidden !important; }
      .shape canvas { visibility: visible !important; }`,
  });
  const png = await canvas.screenshot({ omitBackground: true });
  // Chromium encodes WebP from a canvas: no image library needed.
  const webp = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const size = 800;
    const target = document.createElement('canvas');
    target.width = size;
    target.height = size;
    target.getContext('2d')?.drawImage(image, 0, 0, size, size);
    return target.toDataURL('image/webp', 0.86).split(',')[1] ?? '';
  }, png.toString('base64'));
  await writeFile(join(out, `${theme}.webp`), Buffer.from(webp, 'base64'));
  console.log(`shape-stills: ${theme}.webp`);
  await page.close();
}
await browser.close();
