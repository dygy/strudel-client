import { describe, expect, it } from 'vitest';
import { isZipJunk } from '../zipJunk';

describe('isZipJunk', () => {
  it.each(['__MACOSX/beats/._kick.js', 'beats/._kick.js', '._root.js', 'beats/.DS_Store', '.DS_Store'])(
    'drops %s',
    (name) => expect(isZipJunk(name)).toBe(true),
  );
  it.each(['beats/kick.js', 'my_.track.js', 'MACOSX/notes.md', 'beats/metadata.json'])('keeps %s', (name) =>
    expect(isZipJunk(name)).toBe(false),
  );
});
