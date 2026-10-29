import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Live tests against real APIs. Run only on demand (`pnpm smoke`), never in `pnpm test`.
// Secrets come from .env.smoke.local (git-ignored); see docs/live-testing.md.
const ENV_FILE = '.env.smoke.local';
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.smoke.ts'],
  },
});
