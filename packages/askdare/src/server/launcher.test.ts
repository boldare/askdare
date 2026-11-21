import { afterEach, describe, expect, it } from 'vitest';
import { createBot } from '../bot/define-bot';
import { LOADER_JS } from '../generated/assets';
import { launcherLook, loaderWithLook } from './launcher';

const hostile = createBot({
  id: 'sage-bot',
  model: 'm',
  instructions: 'x',
  widget: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: hostile input on purpose
    title: 'Ola `${globalThis.pwnedTitle=1}`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: hostile input on purpose
    launcherLabel: '${globalThis.pwned=1}`$` $& \'"',
    theme: 'sage',
  },
});

describe('loaderWithLook (real built loader)', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['pwned'];
    delete (globalThis as Record<string, unknown>)['pwnedTitle'];
  });

  it('inlines the look as plain data, whatever quote the minifier chose', () => {
    const js = loaderWithLook(LOADER_JS, hostile);
    const literal = JSON.stringify(JSON.stringify({ 'sage-bot': launcherLook(hostile) }));
    expect(js).toContain(`JSON.parse(${literal})`);
    expect(js).not.toContain('__ASKDARE_LAUNCHERS__');
    // Still valid JavaScript (a broken loader would fail on every site that embeds it).
    expect(() => new Function(js)).not.toThrow();
    const looks = JSON.parse(new Function(`return ${literal}`)() as string);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: hostile input on purpose
    expect(looks['sage-bot'].texts.pl.label).toBe('${globalThis.pwned=1}`$` $& \'"');
    expect((globalThis as Record<string, unknown>)['pwned']).toBeUndefined();
  });

  it("includes only the requested bot's look", () => {
    const other = createBot({ id: 'internal', model: 'm', instructions: 'x' });
    expect(loaderWithLook(LOADER_JS, hostile)).not.toContain('internal');
    expect(loaderWithLook(LOADER_JS, other)).not.toContain('sage-bot');
    expect(loaderWithLook(LOADER_JS, undefined)).toContain('JSON.parse("{}")');
  });

  it('gives the launcher each language its own texts', () => {
    const multi = createBot({
      id: 'multi',
      model: 'm',
      instructions: 'x',
      widget: {
        locale: 'auto',
        texts: { en: { 'launcher.label': 'Questions?' }, pl: { 'launcher.label': 'Pytania?' } },
      },
    });
    const look = launcherLook(multi);
    expect(look.texts['en']?.label).toBe('Questions?');
    expect(look.texts['pl']?.label).toBe('Pytania?');
    // A language without a dictionary gets its own entry, keyed as the loader looks it up.
    const regional = createBot({
      id: 'regional',
      model: 'm',
      instructions: 'x',
      widget: {
        locale: 'auto',
        texts: { 'nl-BE': { 'launcher.label': 'Vragen?' }, 'pl-PL': { 'launcher.label': 'Hej' } },
      },
    });
    const looks = launcherLook(regional).texts;
    expect(Object.keys(looks)).toEqual(['en', 'cs', 'de', 'es', 'fr', 'it', 'pl', 'nl']);
    expect(looks['nl']?.label).toBe('Vragen?');
    expect(looks['nl']?.open).toBe('Open chat');
    expect(looks['pl']?.label).toBe('Hej');
    // A fixed locale without a dictionary shows its own set in the English entry it uses.
    const dutch = createBot({
      id: 'nl',
      model: 'm',
      instructions: 'x',
      widget: { locale: 'nl', texts: { nl: { 'launcher.label': 'Vragen?' } } },
    });
    expect(launcherLook(dutch).texts['en']?.label).toBe('Vragen?');
  });
});
