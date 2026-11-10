// Size budgets of @boldare/askdare/react (ADR-0011), as an app's bundler would ship it: bundled
// from dist/react.js with React left out, minified and gzipped. The whole entry (the default look
// and the Markdown renderer included) and a headless page that uses only Root and useChat.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = JSON.stringify(join(pkg, 'dist', 'react.js'));
const CASES = [
  { name: 'react.js', budget: 32 * 1024, source: `export * from ${entry};` },
  {
    name: 'headless (Root and useChat)',
    budget: 12 * 1024,
    source: `import { Root, useChat } from ${entry};\nexport { Root, useChat };`,
  },
];

const work = await mkdtemp(join(tmpdir(), 'askdare-size-'));
let failed = false;
try {
  for (const { name, budget, source } of CASES) {
    const file = join(work, 'entry.js');
    await writeFile(file, source);
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        write: false,
        minify: true,
        target: 'es2022',
        lib: { entry: file, formats: ['es'] },
        rolldownOptions: {
          external: [/^react($|\/)/, /^react-dom($|\/)/],
          output: { minify: true },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
    const size = outputs.reduce(
      (sum, chunk) => sum + (chunk.type === 'chunk' ? gzipSync(chunk.code).length : 0),
      0,
    );
    console.log(`react-size: ${name} ${size} B gz (budget ${budget} B)`);
    if (size > budget) {
      console.error(`${name} is ${size} B gzipped; the budget is ${budget} B.`);
      failed = true;
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
if (failed) process.exit(1);
