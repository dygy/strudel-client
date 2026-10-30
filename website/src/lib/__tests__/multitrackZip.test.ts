import { describe, expect, it } from 'vitest';
import { folderOutsideMultitracks, orderStepFiles, stepFileNames } from '../multitrackZip';

describe('stepFileNames', () => {
  it('uses the export rule', () => {
    expect(stepFileNames(['Verse', 'Big drop!'])).toEqual(['Verse.js', 'Big_drop_.js']);
  });

  it('keeps two steps whose names map to one file apart', () => {
    expect(stepFileNames(['A!', 'A?', 'a!'])).toEqual(['A_.js', 'A__2.js', 'a__3.js']);
  });
});

describe('orderStepFiles', () => {
  const pairs = (files: string[], steps?: unknown) =>
    orderStepFiles(files, steps).map(({ file, meta }) => [file, meta?.name]);

  it('pairs each metadata step with its own file, in metadata order (an exported multitrack)', () => {
    // Alphabetically Chorus.js comes first: pairing by sorted position gave "Verse" the chorus code.
    const steps = [{ name: 'Verse' }, { name: 'Chorus' }, { name: 'Outro' }];
    expect(pairs(['Song/Chorus.js', 'Song/Outro.js', 'Song/Verse.js'], steps)).toEqual([
      ['Song/Verse.js', 'Verse'],
      ['Song/Chorus.js', 'Chorus'],
      ['Song/Outro.js', 'Outro'],
    ]);
  });

  it('round-trips steps whose names collide after the export rule', () => {
    const steps = [{ name: 'A!' }, { name: 'A?' }];
    const files = stepFileNames(steps.map((s) => s.name));
    expect(pairs(files.slice().reverse(), steps)).toEqual([
      ['A_.js', 'A!'],
      ['A__2.js', 'A?'],
    ]);
  });

  it('puts files no step claims last, in natural order', () => {
    expect(pairs(['step_10.js', 'Intro.js', 'step_2.js'], [{ name: 'Intro' }])).toEqual([
      ['Intro.js', 'Intro'],
      ['step_2.js', undefined],
      ['step_10.js', undefined],
    ]);
  });

  it('falls back to pairing by position, in natural order, when no step finds its file', () => {
    expect(pairs(['step_10.js', 'step_2.js', 'step_1.js'], [{ name: 'One' }, { name: 'Two' }])).toEqual([
      ['step_1.js', 'One'],
      ['step_2.js', 'Two'],
      ['step_10.js', undefined],
    ]);
  });

  it('works without metadata and ignores a malformed steps value', () => {
    expect(pairs(['b.js', 'a.js'])).toEqual([
      ['a.js', undefined],
      ['b.js', undefined],
    ]);
    expect(pairs(['a.js'], 'nope')).toEqual([['a.js', undefined]]);
    expect(pairs(['a.js'], [null])).toEqual([['a.js', undefined]]);
  });
});

describe('folderOutsideMultitracks', () => {
  const multitracks = new Set(['Song', 'Albums/Live']);

  it('moves a file in a multitrack folder next to the multitrack', () => {
    expect(folderOutsideMultitracks('Song', multitracks)).toBeUndefined();
    expect(folderOutsideMultitracks('Albums/Live', multitracks)).toBe('Albums');
    expect(folderOutsideMultitracks('Albums/Live/notes', multitracks)).toBe('Albums');
  });

  it('leaves other folders alone', () => {
    expect(folderOutsideMultitracks(undefined, multitracks)).toBeUndefined();
    expect(folderOutsideMultitracks('Albums', multitracks)).toBe('Albums');
    expect(folderOutsideMultitracks('Songs', multitracks)).toBe('Songs');
    expect(folderOutsideMultitracks('Albums/Lives', multitracks)).toBe('Albums/Lives');
  });
});
