import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ADMIN_SECRET, ADMIN_USER, IDENTITY_SECRET } from './e2e/support/admin';
import { E2E_DATABASE_URL } from './e2e/support/database';
import {
  WEBHOOK_CERT_DIR,
  WEBHOOK_DEBUG,
  WEBHOOK_PORT,
  WEBHOOK_SECRET,
  WEBHOOK_URL,
} from './e2e/support/webhook';

const APP_ORIGIN = 'http://localhost:3100';
// Ports differ from the dev preview (.claude/launch.json) so both can run at once.
const ALLOWED_HOST = 'http://127.0.0.1:4100';

// Runs against a production build of site/ (`pnpm e2e` builds it first). OpenAI is
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
      // A phone (touch, a narrow viewport, the full-screen panel): the embedding, accessibility, the
      // chat inside a page, forms and handoff. Part of `pnpm e2e`.
      name: 'mobile',
      testMatch: /(embed|a11y|inline|replies|forms|handoff)\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        // The fake microphone of the chromium project, for dictation.
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
    // The embedding, the page API, accessibility, the chat inside a page, forms and handoff in the
    // other engines (`pnpm e2e:browsers`).
    {
      name: 'firefox',
      testMatch:
        /(embed|embed-root|host-api|a11y|inline|feedback|history|replies|tool-cards|forms|handoff)\.spec\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        // A fake microphone without a prompt, like Chromium's flags above.
        launchOptions: {
          firefoxUserPrefs: {
            'media.navigator.streams.fake': true,
            'media.navigator.permission.disabled': true,
          },
        },
      },
    },
    {
      name: 'webkit',
      testMatch:
        /(embed|embed-root|host-api|a11y|inline|feedback|history|replies|tool-cards|forms|handoff)\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      // Safari on an iPhone: WebKit with touch, a narrow viewport and the full-screen panel. It
      // replaces the manual check in Safari on iOS before a release (`pnpm e2e:browsers`).
      name: 'iphone',
      testMatch: /(embed|a11y|inline|replies)\.spec\.ts/,
      use: { ...devices['iPhone 15'] },
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
      // The host page signs visitors in like a site's backend would, with the app's IDENTITY_SECRET.
      env: { APP_ORIGIN, HOST_PORT: '4100', FOREIGN_PORT: '4101', IDENTITY_SECRET },
    },
    {
      // Before the site: it makes the certificate the site is started to trust.
      command: 'node e2e/servers/webhook.mjs',
      url: `${WEBHOOK_DEBUG}/health`,
      reuseExistingServer: false,
      env: {
        WEBHOOK_PORT: String(WEBHOOK_PORT),
        WEBHOOK_DEBUG_PORT: new URL(WEBHOOK_DEBUG).port,
        WEBHOOK_SECRET,
        WEBHOOK_CERT_DIR,
      },
    },
    {
      command: './node_modules/.bin/next start --port 3100',
      cwd: 'site',
      url: `${APP_ORIGIN}/api/chat/widget.js`,
      reuseExistingServer: false,
      timeout: 120_000,
      // Every variable is set explicitly: Next.js lets process env win over the site's own
      // .env files, so a developer's local secrets never leak into the run.
      env: {
        OPENAI_API_KEY: 'sk-e2e-not-a-real-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:4110/v1',
        CHAT_SECRET: 'e2e-secret-that-is-long-enough-for-tests',
        IDENTITY_SECRET,
        ASKDARE_MODEL: 'mock-model',
        ASKDARE_TRANSCRIBE_MODEL: 'mock-transcribe',
        // Lets the visual tests render fixture states; it never changes a live conversation.
        ASKDARE_GALLERY: '1',
        // All tests chat from one address; see the limits in site/askdare.config.ts.
        ASKDARE_E2E_LIMITS: '1',
        KB_VECTOR_STORE_ID: '',
        // No docs chat: it needs a synced vector store.
        DOCS_VECTOR_STORE_ID: '',
        ASKDARE_ALLOWED_ORIGINS: ALLOWED_HOST,
        CHAT_SECRET_PREVIOUS: '',
        ASKDARE_DISABLED: '',
        // Turns on the chat kept in Postgres (site/app/api/e2e-postgres) for e2e/postgres.spec.ts.
        ASKDARE_E2E_DATABASE_URL: E2E_DATABASE_URL ?? '',
        // Handoffs go to the test webhook (e2e/servers/webhook.mjs), over HTTPS it trusts.
        HANDOFF_WEBHOOK_URL: WEBHOOK_URL,
        HANDOFF_WEBHOOK_SECRET: WEBHOOK_SECRET,
        NODE_EXTRA_CA_CERTS: join(WEBHOOK_CERT_DIR, 'cert.pem'),
        // The admin console with the memory store and the dashboard (e2e/admin.spec.ts).
        ADMIN_SECRET,
        ADMIN_ALLOW: ADMIN_USER,
        UPSTASH_REDIS_REST_URL: '',
        KV_REST_API_URL: '',
      },
    },
  ],
});
