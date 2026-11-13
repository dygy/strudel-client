/**
 * @spec: 022-set-playlist (functional 2.1, 2.2; tech 2.1)
 * Set names and items as the API accepts them.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SET_ITEMS, nextFreeSetName, sanitizeItems, setFromRow, validateSetName } from '../setLists';

const item = (over: Record<string, unknown> = {}) => ({ id: 'i1', trackId: 't1', transition: null, ...over });

describe('validateSetName', () => {
  it('trims and accepts 1–100 characters', () => {
    expect(validateSetName('  Friday  ')).toBe('Friday');
    expect(validateSetName('x'.repeat(100))).toBe('x'.repeat(100));
  });

  it('refuses empty, blank, too long and non-strings', () => {
    expect(validateSetName('')).toBeNull();
    expect(validateSetName('   ')).toBeNull();
    expect(validateSetName('x'.repeat(101))).toBeNull();
    expect(validateSetName(42)).toBeNull();
    expect(validateSetName(undefined)).toBeNull();
  });
});

describe('sanitizeItems', () => {
  it('keeps the known fields and drops unknown keys', () => {
    expect(
      sanitizeItems([
        item({ extra: 'x', user_id: 'someone' }),
        item({ id: 'i2', stepId: 's1', stepName: 'Drop', stepIndex: 2, transition: { type: 'crossfade', length: 8 } }),
      ]),
    ).toEqual([
      { id: 'i1', trackId: 't1', transition: null },
      {
        id: 'i2',
        trackId: 't1',
        stepId: 's1',
        stepName: 'Drop',
        stepIndex: 2,
        transition: { type: 'crossfade', length: 8 },
      },
    ]);
  });

  it('treats a missing transition as Default', () => {
    expect(sanitizeItems([{ id: 'i1', trackId: 't1' }])).toEqual([{ id: 'i1', trackId: 't1', transition: null }]);
  });

  it('accepts the same track twice as two items', () => {
    expect(sanitizeItems([item(), item({ id: 'i2' })])).toHaveLength(2);
  });

  it.each([
    ['not an array', { items: [] }],
    ['an empty trackId', [item({ trackId: '' })]],
    ['a trackId over 64 characters', [item({ trackId: 'x'.repeat(65) })]],
    ['a missing item id', [{ trackId: 't1', transition: null }]],
    ['an unknown transition type', [item({ transition: { type: 'wobble', length: 4 } })]],
    ['an unknown transition length', [item({ transition: { type: 'dip', length: 3 } })]],
    ['a string length', [item({ transition: { type: 'dip', length: '4' } })]],
    ['a negative step index', [item({ stepIndex: -1 })]],
    ['a non-integer step index', [item({ stepIndex: 1.5 })]],
    ['two items with one id', [item(), item()]],
    ['a non-object item', ['t1']],
  ])('refuses %s', (_label, value) => {
    expect(sanitizeItems(value)).toBeNull();
  });

  it('accepts 500 items and refuses 501', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item({ id: `i${i}` }));
    expect(sanitizeItems(many(MAX_SET_ITEMS))).toHaveLength(MAX_SET_ITEMS);
    expect(sanitizeItems(many(MAX_SET_ITEMS + 1))).toBeNull();
  });
});

describe('nextFreeSetName', () => {
  it('gives the first free number', () => {
    expect(nextFreeSetName('Set', [])).toBe('Set 1');
    expect(nextFreeSetName('Set', ['Set 1', 'Set 2'])).toBe('Set 3');
    expect(nextFreeSetName('Set', ['Set 2'])).toBe('Set 1');
    expect(nextFreeSetName('Сет', ['Сет 1'])).toBe('Сет 2');
  });
});

describe('setFromRow', () => {
  it('maps updated_at to version and drops damaged items instead of failing', () => {
    expect(
      setFromRow({ id: 's1', name: 'A', items: [item(), { broken: true }], updated_at: '2026-11-13T00:00:00+00:00' }),
    ).toEqual({ id: 's1', name: 'A', items: [item()], version: '2026-11-13T00:00:00+00:00' });
    expect(setFromRow({ id: 's1', name: 'A', items: null, updated_at: 'v' }).items).toEqual([]);
  });
});
