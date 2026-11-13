/**
 * @spec: 022-set-playlist (2.2 step items, 2.5 renamed / deleted; tech §2.1)
 * Step resolution: id (when unique) → name slug → index only with a matching name → Missing.
 */
import { describe, expect, it } from 'vitest';
import { itemLabel, resolveItem, type LibraryTrack } from '../resolveItem';
import type { SetItem } from '../../../lib/setLists';

const multi: LibraryTrack = {
  id: 'm1',
  name: 'Big Set',
  isMultitrack: true,
  steps: [
    { id: 'a', name: 'Intro' },
    { id: 'dup', name: 'Drop' },
    { id: 'dup', name: 'Outro' },
    { id: 'c', name: 'Drop' },
  ],
};
const plain: LibraryTrack = { id: 't1', name: 'Groove', folder: 'f1' };
const tracks = { m1: multi, t1: plain };

const item = (over: Partial<SetItem>): SetItem => ({ id: 'i', trackId: 'm1', transition: null, ...over });

describe('resolveItem', () => {
  it('resolves a plain track by id, so a renamed or moved track keeps its item', () => {
    expect(resolveItem(item({ trackId: 't1' }), tracks)).toEqual({ status: 'ok', track: plain });
    const renamed = { ...plain, name: 'Groove (live)', folder: 'f2' };
    expect(itemLabel(item({ trackId: 't1' }), { t1: renamed })).toEqual({ trackName: 'Groove (live)' });
  });

  it('is Missing when the track is gone', () => {
    expect(resolveItem(item({ trackId: 'gone' }), tracks)).toEqual({ status: 'missing' });
    expect(itemLabel(item({ trackId: 'gone' }), tracks)).toBeNull();
  });

  it('finds a step by its id when exactly one step has it, even after a rename', () => {
    expect(resolveItem(item({ stepId: 'a', stepName: 'Old name', stepIndex: 0 }), tracks)).toMatchObject({
      status: 'ok',
      stepIndex: 0,
    });
  });

  it('falls back to the name when the id repeats', () => {
    expect(resolveItem(item({ stepId: 'dup', stepName: 'Outro', stepIndex: 2 }), tracks)).toMatchObject({
      stepIndex: 2,
    });
  });

  it('with several steps of that name, takes the one at stepIndex', () => {
    expect(resolveItem(item({ stepName: 'drop', stepIndex: 3 }), tracks)).toMatchObject({ stepIndex: 3 });
    expect(resolveItem(item({ stepName: 'Drop', stepIndex: 0 }), tracks)).toMatchObject({ stepIndex: 1 });
  });

  it('never takes a step by index when its name no longer matches: Missing', () => {
    expect(resolveItem(item({ stepId: 'zzz', stepName: 'Breakdown', stepIndex: 0 }), tracks)).toEqual({
      status: 'missing',
    });
    expect(resolveItem(item({ stepIndex: 0 }), tracks)).toEqual({ status: 'missing' });
  });

  it('a step item on a track that is no longer a multitrack is Missing', () => {
    expect(resolveItem(item({ trackId: 't1', stepName: 'Intro' }), tracks)).toEqual({ status: 'missing' });
  });

  it('labels a step with the multitrack name and the live step name', () => {
    expect(itemLabel(item({ stepId: 'a', stepName: 'Old' }), tracks)).toEqual({
      trackName: 'Big Set',
      stepName: 'Intro',
    });
  });
});
