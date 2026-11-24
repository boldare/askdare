import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// The skin imports the public entry, as an ejected copy does (ADR-0011).
const askdareReact = {
  find: /^@boldare\/askdare\/react$/,
  replacement: fileURLToPath(new URL('./packages/askdare/src/react/headless.ts', import.meta.url)),
};

// The contract suites, as add-ons import them, without building the package first.
const askdareTesting = {
  find: /^@boldare\/askdare\/testing$/,
  replacement: fileURLToPath(new URL('./packages/askdare/src/testing/index.ts', import.meta.url)),
};

// The core entry for add-ons, from the same source as the suites: a class such as
// VersionConflictError is then one class, as it is between the built entries.
const askdare = {
  find: /^@boldare\/askdare$/,
  replacement: fileURLToPath(new URL('./packages/askdare/src/index.ts', import.meta.url)),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: [askdareReact, askdareTesting, askdare] },
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.{ts,tsx}'],
          // So `askdare.css?raw` is the stylesheet's text in the skin's guard test.
          css: { include: [/askdare\.css/] },
          exclude: [...configDefaults.exclude, '**/*.preact.test.tsx'],
        },
      },
      {
        // The iframe builds the same components with Preact (vite.widget.config.ts).
        resolve: {
          alias: [
            askdareReact,
            { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
            { find: /^react-dom$/, replacement: 'preact/compat' },
            { find: /^react\/jsx-(dev-)?runtime$/, replacement: 'preact/jsx-runtime' },
            { find: /^react$/, replacement: 'preact/compat' },
          ],
        },
        test: {
          name: 'preact',
          include: ['packages/*/src/**/*.preact.test.tsx'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
