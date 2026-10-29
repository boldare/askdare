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

describe('built-in presets', () => {
  it.each(PRESET_NAMES.flatMap((name) => [[name, 'light'] as const, [name, 'dark'] as const]))(
    '%s (%s) meets WCAG AA, and AAA for text in Care',
    (name, scheme) => {
      const level = name === 'care' ? 'AAA' : 'AA';
      expect(contrastFailures(PRESETS[name][scheme], level)).toEqual([]);
    },
  );
});
