import { describe, expect, it } from 'vitest';
import { forLog, scrub } from './errors';

describe('scrub', () => {
  it('keeps only the prefix of API keys', () => {
    expect(scrub('key sk-proj-abcdef123 and rk-live-123456')).toBe('key sk-… and rk-…');
  });
});

describe('forLog', () => {
  const visitorText = 'please call me at +48 600 700 800, my name is Jan Kowalski';

  it('cleans an error message but keeps its name, stack frames and diagnostics', () => {
    const error = Object.assign(new TypeError(`Rejected '${visitorText}' with sk-proj-abcdef123`), {
      status: 400,
      code: 'invalid_value',
      requestId: 'req_1',
      body: { input: visitorText },
    });
    const logged = forLog(error) as Error & Record<string, unknown>;
    expect(logged.name).toBe('TypeError');
    expect(logged.message).toBe("Rejected '[…]' with sk-…");
    expect(logged.stack).toMatch(/^TypeError: Rejected '\[…\]' with sk-…\n\s+at /);
    expect(logged).toMatchObject({ status: 400, code: 'invalid_value', requestId: 'req_1' });
    expect(logged).not.toHaveProperty('body');
    expect(JSON.stringify({ ...logged, stack: logged.stack })).not.toContain('600 700');
  });

  it('cleans strings and reduces anything else to its type', () => {
    expect(forLog(undefined)).toBeUndefined();
    expect(forLog(`"${visitorText}"`)).toBe('"[…]"');
    expect(forLog({ input: visitorText })).toBe('[object]');
    expect(forLog(42)).toBe('[number]');
  });
});
