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
  planFolderMove,
  planFolderRename,
  renamedTrackUrl,
  resolveParentId,
  validateFolderName,
  wouldCreateCycle,
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

  // Different names in any script have different slugs; symbol-only names are 'untitled', not a clash.
  describe('non-Latin and symbol-only names', () => {
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

// Regression (2026-10-30, "folder move by drag doesn't update its path").
describe('planFolderMove', () => {
  const move = (id: string, parent: string | null) => {
    const r = planFolderMove(Object.values(folders), id, parent);
    if ('error' in r) throw new Error(`unexpected ${r.error}`);
    return r.plan;
  };

  it('rebuilds the moved folder and descendant paths below the new parent', () => {
    expect(move(SUB, OTHER).pathChanges).toEqual([
      { id: SUB, oldPath: 'test/Sub Dir', newPath: 'My Beats/Sub Dir' },
      { id: DEEP, oldPath: 'test/Sub Dir/deep', newPath: 'My Beats/Sub Dir/deep' },
    ]);
  });

  it('applies the new parent and paths; the name is unchanged', () => {
    const p = move(SUB, null);
    const next = applyRenameToFolders(folders, p);
    expect(next[SUB]).toMatchObject({ name: 'Sub Dir', path: 'Sub Dir', parent: null });
    expect(next[DEEP].path).toBe('Sub Dir/deep');
    expect(applyRenameToTracks(tracks, p).subByPath.folder).toBe('Sub Dir');
  });

  it('inverting restores the old parent and paths', () => {
    const p = move(SUB, OTHER);
    const back = applyRenameToFolders(applyRenameToFolders(folders, p), invertFolderRenamePlan(p));
    expect(back[SUB]).toMatchObject({ path: 'test/Sub Dir', parent: TEST });
    expect(back[DEEP].path).toBe('test/Sub Dir/deep');
  });

  it('refuses a same-named sibling under the new parent', () => {
    const withClash = [
      ...Object.values(folders),
      { id: 'x', name: 'sub dir', path: 'My Beats/sub dir', parent: OTHER },
    ];
    expect(planFolderMove(withClash, SUB, OTHER)).toEqual({ ok: false, error: 'duplicate' });
  });

  it('keeps a stored name the rename rules would refuse ("/", surrounding spaces)', () => {
    const odd = [...Object.values(folders), { id: 'odd', name: ' a/b ', path: ' a/b ', parent: null }];
    const r = planFolderMove(odd, 'odd', OTHER);
    if ('error' in r) throw new Error(`unexpected ${r.error}`);
    expect(r.plan.newName).toBe(' a/b ');
    expect(r.plan.pathChanges[0].newPath).toBe('My Beats/ a/b ');
  });

  it('moves the open track URL when its folder moves', () => {
    const p = move(DEEP, null);
    const after = { tracks: applyRenameToTracks(tracks, p), folders: applyRenameToFolders(folders, p) };
    expect(renamedTrackUrl({ pathname: '/repl/test/sub-dir/deep/deep-one' }, { tracks, folders }, after, p)).toBe(
      '/repl/deep/deep-one',
    );
  });
});

// Regression (2026-10-30): subfolders created from the context menu stored the parent's PATH in
// `parent`. The cascade looked children up by id only, so renaming or moving the parent left
// them with stale paths, and the tree (which falls back to matching `parent` by path) dropped
// them to the root once the parent's path changed.
describe('folders whose parent is stored as a path', () => {
  const legacy = [
    { id: 'p', name: 'Live', path: 'Live', parent: null },
    { id: 'c', name: 'Drums', path: 'Live/Drums', parent: 'Live' },
    { id: 'g', name: 'Kicks', path: 'Live/Drums/Kicks', parent: 'Live/Drums' },
    { id: 'o', name: 'Other', path: 'Other', parent: null },
  ];
  const ok = (r: ReturnType<typeof planFolderRename>) => {
    if ('error' in r) throw new Error(r.error);
    return r.plan;
  };

  it('resolveParentId maps a path parent to its id', () => {
    expect(resolveParentId(legacy[1], legacy)).toBe('p');
    expect(resolveParentId(legacy[0], legacy)).toBeNull();
    expect(resolveParentId({ id: 'x', name: 'x', path: 'x', parent: 'gone' }, legacy)).toBe('gone');
  });

  it('a rename cascades to them and rewrites their parent to the id', () => {
    const p = ok(planFolderRename(legacy, 'p', 'Set'));
    const next = applyRenameToFolders(Object.fromEntries(legacy.map((f) => [f.id, f])), p);
    expect(next.c).toMatchObject({ path: 'Set/Drums', parent: 'p' });
    expect(next.g).toMatchObject({ path: 'Set/Drums/Kicks', parent: 'c' });
  });

  it('the inverse restores the stored path parents', () => {
    const p = ok(planFolderRename(legacy, 'p', 'Set'));
    const map = Object.fromEntries(legacy.map((f) => [f.id, f]));
    const back = applyRenameToFolders(applyRenameToFolders(map, p), invertFolderRenamePlan(p));
    expect(back.c).toMatchObject({ path: 'Live/Drums', parent: 'Live' });
    expect(back.g).toMatchObject({ path: 'Live/Drums/Kicks', parent: 'Live/Drums' });
  });

  it('a move cascades to them too', () => {
    const p = ok(planFolderMove(legacy, 'c', 'o'));
    expect(p.pathChanges.map((c) => c.newPath)).toEqual(['Other/Drums', 'Other/Drums/Kicks']);
  });

  it('siblings are found whichever way their parent is stored', () => {
    const withSibling = [...legacy, { id: 's', name: 'drums', path: 'Live/drums', parent: 'p' }];
    expect(validateFolderName('Drums', withSibling[4], withSibling)).toBe('duplicate');
  });

  it('wouldCreateCycle follows path parents', () => {
    expect(wouldCreateCycle(legacy, 'p', 'g')).toBe(true);
    expect(wouldCreateCycle(legacy, 'g', 'o')).toBe(false);
  });
});
