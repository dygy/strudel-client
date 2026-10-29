import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tracksActions } from '../tracksStore';

// The store rebuilds track.folder from the raw folder path ("My Beats") while the URL
// carries its slug ("my-beats"). A miss here falls back to a random track, which then
// races the file manager's own (correct) URL resolution for the editor.
const ssrFor = (extra: Record<string, unknown>) => ({
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
  ...extra,
});

const selectFor = (extra: Record<string, unknown>) =>
  new Promise<string | null>((resolve) =>
    tracksActions.initializeWithCoordination(ssrFor(extra), (t) => resolve(t?.id ?? null)),
  );

describe('tracksStore — initial track for a folder URL', () => {
  beforeEach(() => {
    tracksActions.clear();
    // Random fallback always lands on the first track ('spiral'), so a miss can't pass by luck
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  it('selects the track in a folder whose name is not already a slug', async () => {
    expect(await selectFor({ targetTrackSlug: 'groove-1', targetFolderPath: 'my-beats' })).toBe('groove');
  });

  it('prefers the track id the server already resolved', async () => {
    expect(await selectFor({ targetTrackId: 'groove', targetTrackSlug: 'groove-1', targetFolderPath: 'x' })).toBe(
      'groove',
    );
  });

  it('still falls back to a random track when the URL matches nothing', async () => {
    expect(await selectFor({ targetTrackSlug: 'groove-1', targetFolderPath: 'other' })).toBe('spiral');
  });
});
