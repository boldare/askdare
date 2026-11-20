import { describe, expect, it } from 'vitest';
import { isToolUi, isToolUiList, MAX_TOOL_UI_BYTES, toToolUiData } from './tool-ui';

const nested = (levels: number): unknown => {
  let value: unknown = 'leaf';
  for (let level = 0; level < levels; level += 1) value = { next: value };
  return value;
};

describe('tool UI data', () => {
  it('passes plain JSON through as a fresh copy', () => {
    const data = { slots: [{ at: '9:00', free: true, seats: 2 }], note: null };
    const sent = toToolUiData(data);
    expect(sent).toEqual(data);
    expect(sent).not.toBe(data);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a function', { pick: () => 1 }],
    ['undefined in an object', { at: undefined }],
    ['NaN', { seats: Number.NaN }],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['a Date', { at: new Date(0) }],
    ['a Map', new Map()],
    ['a class instance', new (class Slot {})()],
    ['a bigint', { seats: 1n }],
    ['a symbol', Symbol('x')],
    ['a hole in an array', new Array<number>(3)],
  ])('refuses %s, which JSON would change or drop', (_, value) => {
    expect(toToolUiData(value)).toBeUndefined();
  });

  it('accepts an object without a prototype', () => {
    const data = Object.assign(Object.create(null) as object, { a: 1 });
    expect(toToolUiData(data)).toEqual({ a: 1 });
  });

  it('allows 8 levels and refuses 9', () => {
    expect(toToolUiData(nested(8))).toBeDefined();
    expect(toToolUiData(nested(9))).toBeUndefined();
  });

  it('counts the size in UTF-8 bytes and refuses a payload over 8 KB whole', () => {
    // Two quotes around the string.
    expect(toToolUiData('x'.repeat(MAX_TOOL_UI_BYTES - 2))).toBeDefined();
    expect(toToolUiData('x'.repeat(MAX_TOOL_UI_BYTES - 1))).toBeUndefined();
    expect(toToolUiData('ż'.repeat(MAX_TOOL_UI_BYTES / 2))).toBeUndefined();
  });
});

describe('tool UI over the wire', () => {
  const card = { callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } };

  it('checks the call, the name and the data', () => {
    expect(isToolUi(card)).toBe(true);
    expect(isToolUi({ ...card, callId: '' })).toBe(false);
    expect(isToolUi({ ...card, callId: 'c'.repeat(129) })).toBe(false);
    expect(isToolUi({ ...card, name: 'find slots' })).toBe(false);
    expect(isToolUi({ ...card, data: null })).toBe(false);
    expect(isToolUi({ ...card, data: nested(9) })).toBe(false);
    expect(isToolUi([card])).toBe(false);
  });

  it('takes one to four payloads, each call once', () => {
    const cards = [1, 2, 3, 4, 5].map((n) => ({ ...card, callId: `c${n}` }));
    expect(isToolUiList(cards.slice(0, 4))).toBe(true);
    expect(isToolUiList(cards)).toBe(false);
    expect(isToolUiList([])).toBe(false);
    expect(isToolUiList([card, card])).toBe(false);
  });
});
