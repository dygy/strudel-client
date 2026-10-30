/**
 * Track and folder URLs for names in any script.
 *
 * Regression (2026-10-30): slugs kept only a-z and 0-9, so every Cyrillic, Hebrew, Arabic, Chinese
 * or Korean name — the app speaks all of these — became "untitled". Two such tracks in a folder
 * shared one URL (the URL picks the track autosave writes to), and a folder with such a name had no
 * URL segment, so its tracks could not be opened by URL at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findStepIndexByName,
  findTrackByFolderAndSlug,
  folderPathToSlug,
  generateTrackUrlPath,
  parseTrackUrlPath,
  trackNameToSlug,
} from '../slugUtils';
import { trackNameClashes } from '../trackRename';

let spies: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
  ];
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

describe('trackNameToSlug', () => {
  it('gives Latin names the same slugs as before', () => {
    expect(trackNameToSlug('Hello World')).toBe('hello-world');
    expect(trackNameToSlug('  My_Track!! v2 ')).toBe('my-track-v2');
    expect(trackNameToSlug('ABC')).toBe('abc');
    expect(trackNameToSlug('___')).toBe('untitled');
  });

  it.each([
    ['Бит 1', 'бит-1'],
    ['Ударные', 'ударные'],
    ['שיר חדש', 'שיר-חדש'],
    ['إيقاع', 'إيقاع'],
    ['节奏 2', '节奏-2'],
    ['드럼 루프', '드럼-루프'],
    ['Café', 'café'],
  ])('keeps the letters of %s, percent-encoded', (name, slug) => {
    expect(trackNameToSlug(name)).toBe(encodeURIComponent(slug));
    expect(trackNameToSlug(name)).toMatch(/^[A-Za-z0-9%-]+$/);
  });

  it('is the same for composed and decomposed forms of a name', () => {
    expect(trackNameToSlug('Café'.normalize('NFD'))).toBe(trackNameToSlug('Café'.normalize('NFC')));
  });

  it('still calls a name with no letters or digits "untitled"', () => {
    expect(trackNameToSlug('★ ♪ !!')).toBe('untitled');
    expect(trackNameToSlug('')).toBe('untitled');
  });
});

describe('URLs for non-Latin names', () => {
  const MUSIC = { id: 'Vh3kQ9xZp2LmT8rB1cYwA', name: 'Музыка', path: 'Музыка' };
  const folders = [MUSIC];
  const foldersMap = { [MUSIC.id]: MUSIC };
  const beat = { id: 'beat', name: 'Бит', folder: MUSIC.id };
  const melody = { id: 'melody', name: 'Мелодия', folder: MUSIC.id };
  const tracks = [beat, melody];

  it('gives each track its own URL, with a folder segment', () => {
    const beatUrl = generateTrackUrlPath(beat.name, beat.folder, foldersMap);
    const melodyUrl = generateTrackUrlPath(melody.name, melody.folder, foldersMap);
    expect(beatUrl).toBe(`/repl/${encodeURIComponent('музыка')}/${encodeURIComponent('бит')}`);
    expect(melodyUrl).not.toBe(beatUrl);
    expect(folderPathToSlug('Музыка/Ударные')).toBe(`${encodeURIComponent('музыка')}/${encodeURIComponent('ударные')}`);
  });

  it('opens the right track from the encoded URL (location.pathname) and from the decoded one', () => {
    for (const track of tracks) {
      const url = generateTrackUrlPath(track.name, track.folder, foldersMap);
      for (const path of [url, decodeURIComponent(url)]) {
        const parsed = parseTrackUrlPath(path)!;
        expect(findTrackByFolderAndSlug(tracks, parsed.folderPath, parsed.trackSlug, folders)?.id).toBe(track.id);
      }
    }
  });

  it('opens the right track when the caller splits location.pathname itself (encoded parts)', () => {
    const url = generateTrackUrlPath(melody.name, melody.folder, foldersMap);
    const [, , folderSlug, trackSlug] = url.split('/');
    expect(findTrackByFolderAndSlug(tracks, folderSlug, trackSlug, folders)?.id).toBe('melody');
  });

  it('a URL with a broken escape does not throw', () => {
    expect(parseTrackUrlPath('/repl/%E0%A4%A/beat')).toEqual({ folderPath: '%E0%A4%A', trackSlug: 'beat' });
  });

  it('finds a step by its non-Latin name from the decoded ?step= value', () => {
    const song = { steps: [{ name: 'Куплет' }, { name: 'Припев 2' }] };
    expect(findStepIndexByName(song, new URLSearchParams(`step=${trackNameToSlug('Припев 2')}`).get('step')!)).toBe(1);
    expect(findStepIndexByName(song, trackNameToSlug('Припев 2'))).toBe(1);
    expect(findStepIndexByName(song, 'Куплет')).toBe(0);
  });

  it('two different non-Latin names in one folder no longer clash; the same slug does', () => {
    expect(trackNameClashes('Мелодия', MUSIC.id, 'new', [beat], folders)).toBe(false);
    expect(trackNameClashes('бит!', MUSIC.id, 'new', [beat], folders)).toBe(true);
  });
});
