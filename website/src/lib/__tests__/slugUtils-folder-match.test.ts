import { describe, it, expect } from 'vitest';
import { findTrackByFolderAndSlug, generateTrackUrlPath, parseTrackUrlPath } from '../slugUtils';

// tracks.folder holds either a folder id (most rows) or a folder path (older rows).
// The URL always carries the slugified folder path, so a reload must resolve both.
const folders = [
  { id: 'jxldrFutJzzdJcI0FcgSZ', name: 'test', path: 'test' },
  { id: 'aB3dEfGhIjKlMnOpQrStU', name: 'My Beats', path: 'My Beats' },
  { id: 'nested0000000000000ab', name: 'Deep Cuts', path: 'My Beats/Deep Cuts' },
];
const foldersMap = Object.fromEntries(folders.map((f) => [f.id, f]));

const tracks = [
  { id: 'spiral', name: 'spiral', folder: null },
  { id: 'taka', name: 'taka', folder: 'jxldrFutJzzdJcI0FcgSZ' },
  { id: 'taka-root', name: 'taka', folder: null },
  { id: 'groove', name: 'Groove 1', folder: 'My Beats' },
  { id: 'deep', name: 'deep', folder: 'nested0000000000000ab' },
];

const resolve = (url: string) => {
  const parsed = parseTrackUrlPath(url)!;
  return findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders)?.id ?? null;
};

describe('findTrackByFolderAndSlug — URL reload of tracks in folders', () => {
  it('resolves a track whose folder is stored as a folder id', () => {
    expect(resolve('/repl/test/taka')).toBe('taka');
  });

  it('resolves a track whose folder path is not already a slug', () => {
    expect(resolve('/repl/my-beats/groove-1')).toBe('groove');
  });

  it('resolves a track in a nested folder stored by id', () => {
    expect(resolve('/repl/my-beats/deep-cuts/deep')).toBe('deep');
  });

  it('round-trips every track through generateTrackUrlPath', () => {
    for (const t of tracks) {
      expect(resolve(generateTrackUrlPath(t.name, t.folder, foldersMap))).toBe(t.id);
    }
  });

  it('does not match a same-named track in another folder', () => {
    expect(resolve('/repl/taka')).toBe('taka-root');
    expect(resolve('/repl/my-beats/taka')).toBeNull();
    expect(resolve('/repl/test/spiral')).toBeNull();
  });

  it('still accepts a legacy URL that carries the raw folder id', () => {
    expect(resolve('/repl/jxldrFutJzzdJcI0FcgSZ/taka')).toBe('taka');
  });
});
