import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// axe on every preset, scheme and gallery state, and on a host page with the launcher.
const APP = 'http://localhost:3100/api/chat/embed/support';
const PRESETS = ['halo', 'aura', 'sage', 'care'] as const;
const SCHEMES = ['light', 'dark'] as const;
const STATES = ['welcome', 'conversation', 'streaming', 'attachments', 'error', 'listening'];

/** axe violations as readable lines, optionally only inside one element. */
async function violations(
  page: ConstructorParameters<typeof AxeBuilder>[0]['page'],
  scope?: string,
): Promise<string[]> {
  const builder = new AxeBuilder({ page });
  const { violations: found } = await (scope ? builder.include(scope) : builder).analyze();
  return found.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

// No entrance animations: axe would measure contrast while a message is still fading in.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const preset of PRESETS) {
  for (const scheme of SCHEMES) {
    test(`${preset} ${scheme} has no axe violations`, async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 640 });
      for (const state of STATES) {
        await page.goto(`${APP}?${new URLSearchParams({ gallery: state, preset, scheme })}`);
        await page.locator('[data-ask-part="panel"]').waitFor();
        expect(await violations(page), `${state}`).toEqual([]);
      }
    });
  }
}

test('the launcher on a host page has no axe violations', async ({ page }) => {
  await page.goto('http://127.0.0.1:4100/');
  await page.locator('[part="launcher"]').waitFor();
  // Only the widget's element: the test page's own markup is not ours to check.
  expect(await violations(page, '[data-askdare]')).toEqual([]);
});
