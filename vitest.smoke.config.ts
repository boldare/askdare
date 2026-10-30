import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Live tests against real APIs. Run only on demand (`pnpm smoke`), never in `pnpm test`.
// Secrets come from git-ignored env files (see docs/live-testing.md): .env.smoke.local wins,
// otherwise the site's or the starter's own env file is reused so the key exists in one place only.
for (const file of [
  '.env.smoke.local',
  'site/.env.local',
  'site/.env',
  'examples/starter/.env.local',
  'examples/starter/.env',
]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
// process.env stores strings, so assigning undefined would set "undefined".
for (const [name, fallback] of [
  ['SMOKE_MODEL', 'ASKDARE_MODEL'],
  ['SMOKE_VECTOR_STORE_ID', 'KB_VECTOR_STORE_ID'],
] as const) {
  const value = process.env[fallback];
  if (!process.env[name] && value) process.env[name] = value;
}

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.smoke.ts'],
  },
});
