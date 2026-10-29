import { defineConfig, devices } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:3100';
const ALLOWED_HOST = 'http://127.0.0.1:4000';

// Runs against a production build of examples/starter (`pnpm e2e` builds it first). OpenAI is
// replaced by e2e/servers/mock-openai.mjs, so no key or network access is needed.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/servers/mock-openai.mjs',
      url: 'http://127.0.0.1:4010/health',
      reuseExistingServer: false,
    },
    {
      command: 'node e2e/servers/host-page.mjs',
      url: `${ALLOWED_HOST}/`,
      reuseExistingServer: false,
      env: { APP_ORIGIN },
    },
    {
      command: './node_modules/.bin/next start --port 3100',
      cwd: 'examples/starter',
      url: `${APP_ORIGIN}/api/chat/widget.js`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Every variable is set explicitly: Next.js lets process env win over the starter's own
      // .env files, so a developer's local secrets never leak into the run.
      env: {
        OPENAI_API_KEY: 'sk-e2e-not-a-real-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:4010/v1',
        CHAT_SECRET: 'e2e-secret-that-is-long-enough-for-tests',
        CHATDOCK_MODEL: 'mock-model',
        CHATDOCK_ALLOWED_ORIGINS: ALLOWED_HOST,
        CHAT_SECRET_PREVIOUS: '',
        CHATDOCK_DISABLED: '',
      },
    },
  ],
});
