import { describe, expect, it } from 'vitest';
import { isBasePath } from './base-path';

describe('isBasePath', () => {
  it('takes a path on the app itself', () => {
    expect(['/api/chat', '/chat', '/a/b.c/d~e_f-g'].every(isBasePath)).toBe(true);
  });

  it('refuses other origins, relative paths and anything that needs escaping', () => {
    const refused = [
      '',
      '/',
      'api/chat',
      '//evil.example/api',
      'https://evil.example/api/chat',
      '/api/chat/',
      '/api//chat',
      '/api/chat?x=1',
      '/api/<script>',
      '/api\\chat',
    ];
    expect(refused.filter(isBasePath)).toEqual([]);
  });
});
