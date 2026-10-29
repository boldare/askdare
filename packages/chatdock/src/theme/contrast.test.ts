import { describe, expect, it } from 'vitest';
import { contrastFailures, contrastRatio, readableOn } from './contrast';
import { PRESET_NAMES, PRESETS } from './presets';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(readableOn('#1f5fe0')).toBe('#ffffff');
    expect(readableOn('#f3a6f0')).toBe('#0b0b0b');
  });
});

/** What `color-mix(in srgb, color P%, #000)` paints. */
const darken = (hex: string, keep: number): string =>
  `#${[1, 3, 5]
    .map((at) =>
      Math.round(Number.parseInt(hex.slice(at, at + 2), 16) * keep)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

describe('built-in presets', () => {
  it('keep text readable across the Aura gradient of messages and Send', () => {
    const { light, dark } = PRESETS.aura;
    // styles.css: user bubble into the accent, or into a deeper accent in the dark scheme.
    for (const [tokens, end] of [
      [light, light.accent],
      [dark, darken(dark.accent, 0.55)],
    ] as const) {
      expect(contrastRatio(tokens.onUserBubble, tokens.userBubble)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.onUserBubble, end)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(PRESET_NAMES.flatMap((name) => [[name, 'light'] as const, [name, 'dark'] as const]))(
    '%s (%s) meets WCAG AA, and AAA for text in Care',
    (name, scheme) => {
      const level = name === 'care' ? 'AAA' : 'AA';
      expect(contrastFailures(PRESETS[name][scheme], level)).toEqual([]);
    },
  );
});
