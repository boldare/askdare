import { describe, expect, it } from 'vitest';
import { adminDashboard } from './index';

describe('adminDashboard', () => {
  it('returns the inlined assets and the read handlers', () => {
    const dashboard = adminDashboard();
    expect(dashboard.script).toContain('askdareAdminDashboard');
    expect(dashboard.style).toContain('.askdare-dashboard');
    expect(Object.keys(dashboard.handlers).sort()).toEqual([
      'conversations',
      'days',
      'ratings',
      'transcript',
    ]);
  });

  it('refuses prices that are not numbers of 0 or more', () => {
    expect(() => adminDashboard({ prices: { m: { input: -1, output: 1 } } })).toThrow(TypeError);
    expect(() => adminDashboard({ prices: { m: { input: 1, output: Number.NaN } } })).toThrow(
      TypeError,
    );
    expect(() =>
      adminDashboard({ prices: { m: { input: 1, cachedInput: 0, output: 4 } } }),
    ).not.toThrow();
  });

  it('keeps no model IDs or prices of its own', () => {
    expect(adminDashboard().script).not.toMatch(/gpt-|o\d-mini/);
  });
});
