/**
 * Regression (2026-10-30): initializeWithCoordination ran the whole initialisation synchronously
 * inside `new Promise(...)`, then stored the promise with `{ ...currentState, initializationPromise }`
 * — the state captured BEFORE initialising. That wrote the empty pre-init state back over the
 * store: tracks, folders, the selected track and loadingPhase 'complete' were all lost right
 * after onComplete reported them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tracksActions, tracksStore } from '../tracksStore';

const ssr = {
  children: [
    { id: 'spiral', name: 'spiral', type: 'track', code: 's1', created: '', modified: '' },
    {
      id: 'beats',
      name: 'My Beats',
      path: 'My Beats',
      type: 'folder',
      created: '',
      children: [{ id: 'groove', name: 'Groove 1', type: 'track', code: 'g1', created: '', modified: '' }],
    },
  ],
  targetTrackId: 'groove',
  targetTrackSlug: 'groove-1',
  targetFolderPath: 'my-beats',
};

describe('tracksStore.initializeWithCoordination keeps what it loaded', () => {
  beforeEach(() => {
    tracksActions.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('the store still holds the tracks, folders and selection after the call returns', () => {
    let reported: string | null = null;
    tracksActions.initializeWithCoordination(ssr, (t) => (reported = t?.id ?? null));

    const state = tracksStore.get();
    expect(reported).toBe('groove');
    expect(Object.keys(state.tracks).sort()).toEqual(['groove', 'spiral']);
    expect(Object.keys(state.folders)).toHaveLength(1);
    expect(state.selectedTrack).toBe('groove');
    expect(state.loadingPhase).toBe('complete');
    expect(state.initializationPromise).toBeInstanceOf(Promise);
  });

  it('a second call waits for the first and reports the same track, without reloading', async () => {
    tracksActions.initializeWithCoordination(ssr, () => {});
    const second = await new Promise<string | null>((resolve) =>
      tracksActions.initializeWithCoordination({ children: [] }, (t) => resolve(t?.id ?? null)),
    );
    expect(second).toBe('groove');
    expect(Object.keys(tracksStore.get().tracks)).toHaveLength(2);
  });
});
