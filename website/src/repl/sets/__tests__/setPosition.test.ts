/**
 * @spec: 022-set-playlist (2.3 after a reload; tech §2.3)
 * The set position survives a reload; a damaged value or a throwing storage is no position, never a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSetPosition, SET_POSITION_KEY, writeSetPosition } from '../setPosition';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

let warn: { mockRestore: () => void };
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('set position', () => {
  it('round-trips the set, Now playing and Up next (and nothing else)', () => {
    const storage = memoryStorage();
    writeSetPosition({ setId: 's1', nowItemId: 'i2', nextItemId: 'i3', cuedItemId: 'i3' } as never, storage);
    expect(JSON.parse(storage.map.get(SET_POSITION_KEY)!)).toEqual({ setId: 's1', nowItemId: 'i2', nextItemId: 'i3' });
    expect(readSetPosition(storage)).toEqual({ setId: 's1', nowItemId: 'i2', nextItemId: 'i3' });
  });

  it('keeps End of set (null Up next) and a set not started yet (null Now playing)', () => {
    const storage = memoryStorage();
    writeSetPosition({ setId: 's1', nowItemId: null, nextItemId: null }, storage);
    expect(readSetPosition(storage)).toEqual({ setId: 's1', nowItemId: null, nextItemId: null });
  });

  it('removes the key when no set plays', () => {
    const storage = memoryStorage();
    writeSetPosition({ setId: 's1', nowItemId: null, nextItemId: 'i1' }, storage);
    writeSetPosition(null, storage);
    expect(storage.map.has(SET_POSITION_KEY)).toBe(false);
    expect(readSetPosition(storage)).toBeNull();
  });

  it.each([
    ['unparseable', '{oops'],
    ['an array', '[]'],
    ['no set id', JSON.stringify({ nowItemId: 'a', nextItemId: 'b' })],
    ['a numeric item id', JSON.stringify({ setId: 's1', nowItemId: 3, nextItemId: null })],
    ['null', 'null'],
  ])('counts a damaged value (%s) as no position', (_label, raw) => {
    const storage = memoryStorage();
    storage.map.set(SET_POSITION_KEY, raw);
    expect(readSetPosition(storage)).toBeNull();
  });

  it('never throws when storage does', () => {
    expect(readSetPosition(throwing)).toBeNull();
    expect(() => writeSetPosition({ setId: 's1', nowItemId: null, nextItemId: null }, throwing)).not.toThrow();
    expect(() => writeSetPosition(null, throwing)).not.toThrow();
  });
});
