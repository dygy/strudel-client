/**
 * @spec: 005-random-track-loading-fix
 * `/repl` with no track named redirects to a random track's URL, and that URL must open a track:
 * otherwise every load redirects to another random track (a redirect loop).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomTrackUrl } from '../randomTrack';
import { findTrackByFolderAndSlug, parseTrackUrlPath } from '../slugUtils';

// A folder whose name has no letters or digits at all gets no URL segment, so its tracks' URLs
// point at the root, where they are not (a known gap of folder URLs).
const UNREACHABLE_FOLDER = { id: 'Vh3kQ9xZp2LmT8rB1cYwA', name: '♪♪♪', path: '♪♪♪' };
const DRUMS = { id: 'Dr0mS5kQ9xZp2LmT8rB1c', name: 'Drums', path: 'Drums' };
const folders = [UNREACHABLE_FOLDER, DRUMS];

const lost = { id: 'lost', name: 'Beat', folder: UNREACHABLE_FOLDER.id };
const kick = { id: 'kick', name: 'Kick loop', folder: DRUMS.id };
const intro = { id: 'intro', name: 'Intro', folder: null };

/** Each random() call returns the next value. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
};

const opens = (url: string, tracks: Array<{ id: string; name: string; folder?: string | null }>) => {
  const parsed = parseTrackUrlPath(url)!;
  return findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders)?.id;
};

let logSpy: { mockRestore: () => void }[] = [];
beforeEach(() => {
  logSpy = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
  ];
});
afterEach(() => logSpy.forEach((s) => s.mockRestore()));

describe('randomTrackUrl', () => {
  it('returns a URL that opens the chosen track', () => {
    const tracks = [intro, kick];
    expect(randomTrackUrl(tracks, folders, () => 0)).toBe('/repl/intro');
    expect(randomTrackUrl(tracks, folders, () => 0.99)).toBe('/repl/drums/kick-loop');
    for (const r of [0, 0.5, 0.99]) {
      const url = randomTrackUrl(tracks, folders, () => r)!;
      expect(tracks.map((t) => t.id)).toContain(opens(url, tracks));
    }
  });

  it('skips a track whose URL opens nothing and picks another', () => {
    const tracks = [lost, kick];
    // The first draw lands on `lost`, whose URL finds no track.
    expect(opens('/repl/beat', tracks)).toBeUndefined();
    expect(randomTrackUrl(tracks, folders, sequence(0, 0))).toBe('/repl/drums/kick-loop');
  });

  it('returns null rather than a URL that opens nothing (no redirect loop)', () => {
    expect(randomTrackUrl([lost], folders, () => 0)).toBeNull();
    expect(randomTrackUrl([], folders)).toBeNull();
  });

  it('adds the first step of a multitrack', () => {
    const song = {
      id: 'song',
      name: 'Song',
      folder: null,
      isMultitrack: true,
      steps: [{ name: 'Verse 1' }, { name: 'Chorus' }],
    };
    expect(randomTrackUrl([song], folders, () => 0)).toBe('/repl/song?step=verse-1');
    expect(randomTrackUrl([{ ...song, steps: [] }], folders, () => 0)).toBe('/repl/song');
  });
});
