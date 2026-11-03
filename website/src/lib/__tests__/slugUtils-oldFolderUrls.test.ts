/**
 * @spec: 018-strudel-mcp-server
 * @regression
 * A folder part with no letters or digits used to be left out of the address. It's kept now, so such
 * tracks can open, but a link from before has to keep opening too: a miss sends the page to a random track.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTrackByFolderAndSlug, generateTrackUrlPath, parseTrackUrlPath, trackNameToSlug } from '../slugUtils';

/** How addresses were made before: the rule this test keeps honest about what old links look like. */
const oldUrl = (path: string, name: string) => {
  const folder = path
    .split('/')
    .map((segment) => trackNameToSlug(segment))
    .filter((segment) => segment && segment !== 'untitled')
    .join('/');
  return folder ? `/repl/${folder}/${trackNameToSlug(name)}` : `/repl/${trackNameToSlug(name)}`;
};

const ID = 'V1StGXR8_Z5jdHi6B-myT';
const opens = (url: string, tracks: Array<{ id: string; name: string; folder: string | null }>, folders: never[]) => {
  const parsed = parseTrackUrlPath(url)!;
  return findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders)?.id;
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('old and new addresses', () => {
  // `Untitled` and `♪♪♪` on their own had no folder part at all, so their old address was the top level,
  // where the track isn't: those links never opened, and only the new address has to.
  it.each([
    ['normal', 'Live Sets', '/repl/live-sets/my-song', '/repl/live-sets/my-song'],
    ['nested', 'Live Sets/Night', '/repl/live-sets/night/my-song', '/repl/live-sets/night/my-song'],
    ['Cyrillic', 'Сеты', `/repl/${trackNameToSlug('Сеты')}/my-song`, `/repl/${trackNameToSlug('Сеты')}/my-song`],
    ['Chinese', '现场/夜晚', null, null],
    ['Untitled first', 'Untitled/Sub', '/repl/sub/my-song', '/repl/untitled/sub/my-song'],
    ['Untitled last', 'Sub/Untitled', '/repl/sub/my-song', '/repl/sub/untitled/my-song'],
    ['no letters in the middle', 'A/!!!/B', '/repl/a/b/my-song', '/repl/a/untitled/b/my-song'],
  ])('%s: both open it', (_label, path, expectedOld, expectedNew) => {
    const folders = [{ id: ID, name: path.split('/').pop()!, path }] as never[];
    const tracks = [{ id: 'mine', name: 'My Song', folder: ID }];
    const before = oldUrl(path, 'My Song');
    const now = generateTrackUrlPath('My Song', path);
    if (expectedOld) expect(before).toBe(expectedOld);
    if (expectedNew) expect(now).toBe(expectedNew);
    expect(opens(before, tracks, folders)).toBe('mine');
    expect(opens(now, tracks, folders)).toBe('mine');
  });

  it.each(['Untitled', '♪♪♪', '!!!'])('%s alone: the new address opens it', (path) => {
    const folders = [{ id: ID, name: path, path }] as never[];
    const tracks = [{ id: 'mine', name: 'My Song', folder: ID }];
    expect(opens(generateTrackUrlPath('My Song', path), tracks, folders)).toBe('mine');
  });

  it('keeps the address of everything else exactly as it was', () => {
    for (const path of ['Live Sets', 'Live Sets/Night', 'Сеты', '现场/夜晚', 'a b/c']) {
      expect(generateTrackUrlPath('My Song', path)).toBe(oldUrl(path, 'My Song'));
    }
  });

  it("when an old address is also another folder's address, that folder's track opens, whichever comes first", () => {
    const folders = [
      { id: 'Sub_Untitled_0000000001', name: 'Untitled', path: 'Sub/Untitled' },
      { id: 'Sub_only_00000000000002', name: 'Sub', path: 'Sub' },
    ] as never[];
    const inUntitled = { id: 'under-untitled', name: 'My Song', folder: 'Sub_Untitled_0000000001' };
    const inSub = { id: 'in-sub', name: 'My Song', folder: 'Sub_only_00000000000002' };
    expect(opens('/repl/sub/my-song', [inUntitled, inSub], folders)).toBe('in-sub');
    expect(opens('/repl/sub/my-song', [inSub, inUntitled], folders)).toBe('in-sub');
    expect(opens('/repl/sub/untitled/my-song', [inSub, inUntitled], folders)).toBe('under-untitled');
  });

  it('an address for nowhere still opens nothing', () => {
    const folders = [{ id: ID, name: 'B', path: 'A/!!!/B' }] as never[];
    const tracks = [{ id: 'mine', name: 'My Song', folder: ID }];
    expect(opens('/repl/a/my-song', tracks, folders)).toBeUndefined();
    expect(opens('/repl/my-song', tracks, folders)).toBeUndefined();
  });
});
