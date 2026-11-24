import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Live evaluation, run on demand only (see eval.test.ts). The key comes from the spike's git-ignored .env.
const env = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);

export default defineConfig({
  test: {
    include: ['spikes/s8-retrieval/k2/eval.test.ts'],
  },
});
