/** Sibling-name rule and the open-track URL for track rename/move (lib/trackRename). */
import { describe, expect, it } from 'vitest';
import { followedTrackUrl, resolveTrackFolder, trackNameClashes } from '../trackRename';

const TEST = 'jxldrFutJzzdJcI0FcgSZ';
const folders = [
  { id: TEST, name: 'test', path: 'test' },
  { id: 'beatsFolder000000000a', name: 'My Beats', path: 'My Beats' },
];
const tracks = [
  { id: 'a', name: 'taka', folder: TEST },
  { id: 'b', name: 'Groove', folder: 'test' },
  { id: 'c', name: 'Бас', folder: null },
  { id: 'd', name: 'spiral', folder: 'root' },
];

describe('resolveTrackFolder', () => {
  it('maps ids to paths and every root spelling to ""', () => {
    expect(resolveTrackFolder(TEST, folders)).toBe('test');
    expect(resolveTrackFolder('test', folders)).toBe('test');
    expect([null, undefined, '', 'root'].map((f) => resolveTrackFolder(f, folders))).toEqual(['', '', '', '']);
  });
});

describe('trackNameClashes', () => {
  it.each([
    ['groove', true],
    ['Groove!', true],
    ['taka', false], // itself
    ['other', false],
  ])('%j next to "Groove" (stored by path) → %s', (name, clash) => {
    expect(trackNameClashes(name, TEST, 'a', tracks, folders)).toBe(clash);
  });

  it('names without a Latin slug clash only by name', () => {
    expect(trackNameClashes('Ударные', null, 'd', tracks, folders)).toBe(false);
    expect(trackNameClashes('бас', null, 'd', tracks, folders)).toBe(true);
  });

  it('a name used in another folder is fine', () => {
    expect(trackNameClashes('spiral', TEST, 'a', tracks, folders)).toBe(false);
  });
});

describe('followedTrackUrl', () => {
  it('follows the open track and keeps the query', () => {
    expect(
      followedTrackUrl({ pathname: '/repl/test/taka', search: '?step=intro' }, tracks, folders, 'a', {
        name: 'Taka Two',
        folder: TEST,
      }),
    ).toBe('/repl/test/taka-two?step=intro');
  });

  it('returns null when the URL is another track or nothing changes', () => {
    expect(followedTrackUrl({ pathname: '/repl/test/groove' }, tracks, folders, 'a', { name: 'x' })).toBeNull();
    expect(
      followedTrackUrl({ pathname: '/repl/test/taka' }, tracks, folders, 'a', { name: 'taka', folder: TEST }),
    ).toBeNull();
  });

  it('follows a root track moved into a folder', () => {
    expect(
      followedTrackUrl({ pathname: '/repl/spiral' }, tracks, folders, 'd', { name: 'spiral', folder: 'My Beats' }),
    ).toBe('/repl/my-beats/spiral');
  });
});
