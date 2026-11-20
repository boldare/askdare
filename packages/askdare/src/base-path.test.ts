import { describe, expect, it } from 'vitest';
import { isBasePath, isEmbedPath, isInside } from './base-path';

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

describe('isEmbedPath', () => {
  it('takes a page of the app, and refuses dot segments and everything isBasePath refuses', () => {
    expect(['/askdare/support', '/chat-frame', '/a/b.c'].every(isEmbedPath)).toBe(true);
    const refused = [
      '/askdare/../api/chat',
      '/./x',
      '/..',
      '//evil.example',
      '/x?y=1',
      '/x#y',
      'x',
    ];
    expect(refused.filter(isEmbedPath)).toEqual([]);
  });
});

describe('isInside', () => {
  it('matches the path itself and what is below it, not a longer name', () => {
    expect(isInside('/api/chat', '/api/chat')).toBe(true);
    expect(isInside('/api/chat/embed/x', '/api/chat')).toBe(true);
    expect(isInside('/api/chatroom', '/api/chat')).toBe(false);
  });
});
