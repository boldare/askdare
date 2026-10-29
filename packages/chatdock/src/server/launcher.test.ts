import { describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { loaderWithLooks } from './launcher';

const LOADER =
  'const a=JSON.parse(\'__CHATDOCK_LAUNCHERS__\');const b=JSON.parse("__CHATDOCK_LAUNCHERS__");';

describe('loaderWithLooks', () => {
  it("inlines each bot's look as a string literal that survives either quote style", () => {
    const bot = defineBot({
      id: 'sage-bot',
      model: 'm',
      instructions: 'x',
      widget: { title: 'Ola\'s "desk"', launcherLabel: 'Ask Ola', theme: 'sage' },
    });
    const js = loaderWithLooks(LOADER, [bot]);
    const single = /JSON\.parse\('(.*?)'\);const b/.exec(js)?.[1] ?? '';
    // Evaluate the single-quoted literal exactly as the browser would.
    const looks = JSON.parse(new Function(`return '${single}'`)() as string);
    expect(looks['sage-bot']).toMatchObject({
      style: 'pill',
      label: 'Ask Ola',
      initials: 'O"',
      accent: '#171a18',
      scheme: 'auto',
    });
    expect(js).toContain('__CHATDOCK_LAUNCHERS__'); // only the first occurrence is replaced
  });
});
