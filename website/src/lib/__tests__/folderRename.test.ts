/**
 * Renaming a folder from the sidebar. Regression (2026-10-29, "can't rename folder"): the tree
 * passes the folder PATH, but the rename looked it up in the id-keyed folders map, so the input
 * opened empty and Enter did nothing; the rename was never persisted and re-keyed the map by path.
 */
import { describe, expect, it } from 'vitest';
import {
  applyRenameToFolders,
  applyRenameToTracks,
  findFolderByPathOrId,
  invertFolderRenamePlan,
  planFolderRename,
  renamedTrackUrl,
  validateFolderName,
  type FolderRenamePlan,
} from '../folderRename';

const TEST = 'jxldrFutJzzdJcI0FcgSZ';
const SUB = 'subFolder00000000000a';
const DEEP = 'deepFolder0000000000b';
const OTHER = 'otherFolder000000000c';

const folders = {
  [TEST]: { id: TEST, name: 'test', path: 'test', parent: null, created: '' },
  [SUB]: { id: SUB, name: 'Sub Dir', path: 'test/Sub Dir', parent: TEST, created: '' },
  [DEEP]: { id: DEEP, name: 'deep', path: 'test/Sub Dir/deep', parent: SUB, created: '' },
  [OTHER]: { id: OTHER, name: 'My Beats', path: 'My Beats', parent: null, created: '' },
};
const tracks = {
  byId: { id: 'byId', name: 'taka', folder: TEST },
  byPath: { id: 'byPath', name: 'old', folder: 'test' },
  subByPath: { id: 'subByPath', name: 'sub', folder: 'test/Sub Dir' },
  deepById: { id: 'deepById', name: 'Deep One', folder: DEEP },
  elsewhere: { id: 'elsewhere', name: 'groove', folder: OTHER },
  root: { id: 'root', name: 'spiral', folder: null },
};

const plan = (id: string, name: string): FolderRenamePlan => {
  const r = planFolderRename(Object.values(folders), id, name);
  if ('error' in r) throw new Error(`unexpected ${r.error}`);
  return r.plan;
};

describe('findFolderByPathOrId', () => {
  it('resolves the folder from the path the tree passes (the bug: lookup by path missed)', () => {
    expect(findFolderByPathOrId(folders, 'test')?.id).toBe(TEST);
    expect(findFolderByPathOrId(folders, 'test/Sub Dir')?.name).toBe('Sub Dir');
  });

  it('resolves the folder by id', () => {
    expect(findFolderByPathOrId(folders, TEST)?.name).toBe('test');
  });
});

describe('validateFolderName', () => {
  const all = Object.values(folders);
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['a/b', 'slash'],
    ['my beats', 'duplicate'],
    ['MY-BEATS!', 'duplicate'],
  ])('%j is refused as %s', (name, error) => {
    expect(validateFolderName(name, folders[TEST], all)).toBe(error);
  });

  it('allows a name that only clashes with a folder under another parent', () => {
    expect(validateFolderName('deep', folders[TEST], all)).toBeNull();
  });

  it('allows changing the case of its own name', () => {
    expect(validateFolderName('TEST', folders[TEST], all)).toBeNull();
  });

  // trackNameToSlug() turns non-Latin and symbol-only names into 'untitled'; that is not a clash.
  describe('names without a Latin slug', () => {
    const sib = (name: string) => ({ id: `sib-${name}`, name, path: name, parent: null });
    const self = { id: 'self', name: 'Drums', path: 'Drums', parent: null };

    it.each([
      ['Ударные', 'Бас'],
      ['鼓', '贝斯'],
      ['드럼', '베이스'],
      ['★★★', '♪♪'],
      ['Ударные', '★★★'],
    ])('allows %j next to %j', (name, sibling) => {
      expect(validateFolderName(name, self, [self, sib(sibling)])).toBeNull();
    });

    it.each([
      ['Ударные', 'ударные'],
      ['鼓', ' 鼓 '],
      ['★★★', '★★★'],
    ])('still refuses %j next to the same name %j', (name, sibling) => {
      expect(validateFolderName(name, self, [self, sib(sibling)])).toBe('duplicate');
    });
  });
});

describe('planFolderRename', () => {
  it('builds the new path from the parent path and cascades to descendants', () => {
    expect(plan(TEST, ' Live ').pathChanges).toEqual([
      { id: TEST, oldPath: 'test', newPath: 'Live' },
      { id: SUB, oldPath: 'test/Sub Dir', newPath: 'Live/Sub Dir' },
      { id: DEEP, oldPath: 'test/Sub Dir/deep', newPath: 'Live/Sub Dir/deep' },
    ]);
  });

  it('renames a nested folder under its parent path', () => {
    expect(plan(SUB, 'Drums').pathChanges[0]).toEqual({ id: SUB, oldPath: 'test/Sub Dir', newPath: 'test/Drums' });
  });

  it('lists every renamed path string for tracks that store paths', () => {
    expect(plan(TEST, 'Live').trackFolderRemaps).toEqual([
      { oldPath: 'test', newPath: 'Live' },
      { oldPath: 'test/Sub Dir', newPath: 'Live/Sub Dir' },
      { oldPath: 'test/Sub Dir/deep', newPath: 'Live/Sub Dir/deep' },
    ]);
  });

  it('refuses an unknown folder', () => {
    expect(planFolderRename(Object.values(folders), 'nope', 'x')).toEqual({ ok: false, error: 'notFound' });
  });
});

describe('applying a rename to client state', () => {
  it('keeps the folders map id-keyed and updates name and paths', () => {
    const next = applyRenameToFolders(folders, plan(TEST, 'Live'));
    expect(Object.keys(next).sort()).toEqual(Object.keys(folders).sort());
    expect(next[TEST]).toMatchObject({ id: TEST, name: 'Live', path: 'Live' });
    expect(next[SUB]).toMatchObject({ name: 'Sub Dir', path: 'Live/Sub Dir' });
    expect(next[DEEP].path).toBe('Live/Sub Dir/deep');
    expect(next[OTHER]).toBe(folders[OTHER]);
  });

  it('rewrites only tracks holding a renamed path; folder ids stay', () => {
    const next = applyRenameToTracks(tracks, plan(TEST, 'Live'));
    expect(next.byPath.folder).toBe('Live');
    expect(next.subByPath.folder).toBe('Live/Sub Dir');
    expect(next.byId.folder).toBe(TEST);
    expect(next.deepById.folder).toBe(DEEP);
    expect(next.elsewhere).toBe(tracks.elsewhere);
  });

  it('the inverse plan restores the previous state', () => {
    const p = plan(TEST, 'Live');
    const inv = invertFolderRenamePlan(p);
    expect(applyRenameToFolders(applyRenameToFolders(folders, p), inv)).toEqual(folders);
    expect(applyRenameToTracks(applyRenameToTracks(tracks, p), inv)).toEqual(tracks);
  });
});

describe('renamedTrackUrl — the open track follows its folder', () => {
  const after = (p: FolderRenamePlan) => ({
    tracks: applyRenameToTracks(tracks, p),
    folders: applyRenameToFolders(folders, p),
  });

  it('moves the URL of a track stored by folder id and keeps ?step=', () => {
    const p = plan(TEST, 'Live Set');
    expect(
      renamedTrackUrl({ pathname: '/repl/test/taka', search: '?step=intro' }, { tracks, folders }, after(p), p),
    ).toBe('/repl/live-set/taka?step=intro');
  });

  it('moves the URL of a track stored by raw path', () => {
    const p = plan(TEST, 'Live');
    expect(renamedTrackUrl({ pathname: '/repl/test/old' }, { tracks, folders }, after(p), p)).toBe('/repl/live/old');
  });

  it('moves the URL of a track in a descendant folder', () => {
    const p = plan(TEST, 'Live');
    expect(renamedTrackUrl({ pathname: '/repl/test/sub-dir/deep/deep-one' }, { tracks, folders }, after(p), p)).toBe(
      '/repl/live/sub-dir/deep/deep-one',
    );
  });

  it('leaves the URL alone when the open track is elsewhere', () => {
    const p = plan(TEST, 'Live');
    expect(renamedTrackUrl({ pathname: '/repl/my-beats/groove' }, { tracks, folders }, after(p), p)).toBeNull();
    expect(renamedTrackUrl({ pathname: '/repl/spiral' }, { tracks, folders }, after(p), p)).toBeNull();
  });
});
