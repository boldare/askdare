import { defineConfig } from 'vitest/config';

// Live tests against real APIs. Run only on demand (`pnpm smoke`), never in `pnpm test`.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.smoke.ts'],
  },
});
