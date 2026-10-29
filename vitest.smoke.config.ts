import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Live tests against real APIs. Run only on demand (`pnpm smoke`), never in `pnpm test`.
// Secrets come from git-ignored env files (see docs/live-testing.md): .env.smoke.local wins,
// otherwise the starter's own .env is reused so the key exists in one place only.
for (const file of ['.env.smoke.local', 'examples/starter/.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
process.env['SMOKE_MODEL'] ??= process.env['CHATDOCK_MODEL'];

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.smoke.ts'],
  },
});
