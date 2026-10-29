import { defineConfig, devices } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:3100';
// Ports differ from the dev preview (.claude/launch.json) so both can run at once.
const ALLOWED_HOST = 'http://127.0.0.1:4100';

// Runs against a production build of examples/starter (`pnpm e2e` builds it first). OpenAI is
// replaced by e2e/servers/mock-openai.mjs, so no key or network access is needed.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      testIgnore: /visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // A fake microphone (a steady tone) for the dictation test, granted without a prompt.
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    {
      // Pixel baselines of the theme gallery (`pnpm test:visual`). They depend on the OS's font
      // rendering, so baselines are kept per platform (the file name ends in -darwin or -linux).
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
      expect: { toHaveScreenshot: { maxDiffPixels: 250, animations: 'disabled' } },
    },
  ],
  webServer: [
    {
      command: 'node e2e/servers/mock-openai.mjs',
      url: 'http://127.0.0.1:4110/health',
      reuseExistingServer: false,
      env: { MOCK_OPENAI_PORT: '4110' },
    },
    {
      command: 'node e2e/servers/host-page.mjs',
      url: `${ALLOWED_HOST}/`,
      reuseExistingServer: false,
      env: { APP_ORIGIN, HOST_PORT: '4100', FOREIGN_PORT: '4101' },
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
        OPENAI_BASE_URL: 'http://127.0.0.1:4110/v1',
        CHAT_SECRET: 'e2e-secret-that-is-long-enough-for-tests',
        CHATDOCK_MODEL: 'mock-model',
        CHATDOCK_TRANSCRIBE_MODEL: 'mock-transcribe',
        // Lets the visual tests render fixture states; it never changes a live conversation.
        CHATDOCK_GALLERY: '1',
        KB_VECTOR_STORE_ID: '',
        CHATDOCK_ALLOWED_ORIGINS: ALLOWED_HOST,
        CHAT_SECRET_PREVIOUS: '',
        CHATDOCK_DISABLED: '',
      },
    },
  ],
});
