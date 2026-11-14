/*
@spec: 018-strudel-mcp-server
upload_track: a Strudel file on this computer goes to the online library without its code passing through the
conversation. The online calls are replaced by a recorder; the sign-in store is a temp file.
*/
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileAuthProvider, MAX_TRACK_BYTES, uploadTrack } from '../src/library.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'strudel-mcp-lib-'));
const recorder = (answers = {}) => {
  const calls = [];
  const call = async (name, args) => {
    calls.push([name, args]);
    return answers[name] ?? { ok: true };
  };
  return { calls, call };
};

describe('uploadTrack', () => {
  it('creates a track from the file, named after it, in the given folder, with the code byte for byte', async () => {
    const d = await dir();
    const code = '// @eq-profile {"bands":[1,2]}\n$: s("bd sd")\n';
    const path = join(d, 'output.strudel');
    await writeFile(path, code);
    const { calls, call } = recorder({ create_track: { id: 't1' } });
    const r = await uploadTrack({ path, folder: 'F1' }, { call });
    expect(calls).toEqual([['create_track', { name: 'output', code, folder: 'F1' }]]);
    expect(r).toEqual({ action: 'created', bytes: Buffer.byteLength(code), result: { id: 't1' } });
  });

  it('updates an existing track naming the version it read first', async () => {
    const d = await dir();
    const path = join(d, 'p.js');
    await writeFile(path, 's("hh*8")');
    const { calls, call } = recorder({ get_track: { version: 'v-42', code: 'old' } });
    const r = await uploadTrack({ path, trackId: 'T', name: 'Renamed' }, { call });
    expect(calls).toEqual([
      ['get_track', { trackId: 'T' }],
      ['update_track', { trackId: 'T', expectedVersion: 'v-42', code: 's("hh*8")', name: 'Renamed' }],
    ]);
    expect(r.action).toBe('updated');
  });

  it('refuses files that are not Strudel source, too large, or empty, without calling the library', async () => {
    const d = await dir();
    const { calls, call } = recorder();
    const secret = join(d, 'id_rsa');
    await writeFile(secret, 'KEY');
    await expect(uploadTrack({ path: secret }, { call })).rejects.toThrow(/Only Strudel files/);
    const big = join(d, 'big.strudel');
    await writeFile(big, 'x'.repeat(MAX_TRACK_BYTES + 1));
    await expect(uploadTrack({ path: big }, { call })).rejects.toThrow(/at most/);
    const empty = join(d, 'e.strudel');
    await writeFile(empty, '  \n');
    await expect(uploadTrack({ path: empty }, { call })).rejects.toThrow(/empty/);
    expect(calls).toEqual([]);
  });
});

describe('the sign-in store', () => {
  it('keeps client and tokens per library URL in a file only the user can read, and forgets them on invalidation', async () => {
    const file = join(await dir(), 'cfg', 'auth.json');
    const a = fileAuthProvider({ serverUrl: 'https://a/mcp', file });
    const b = fileAuthProvider({ serverUrl: 'https://b/mcp', file });
    await a.saveClientInformation({ client_id: 'c1' });
    await a.saveTokens({ access_token: 'x', token_type: 'bearer', refresh_token: 'r' });
    await b.saveTokens({ access_token: 'y', token_type: 'bearer' });
    expect(await a.clientInformation()).toEqual({ client_id: 'c1' });
    expect((await a.tokens()).refresh_token).toBe('r');
    expect((await b.tokens()).access_token).toBe('y');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await a.invalidateCredentials('tokens');
    expect(await a.tokens()).toBeUndefined();
    expect(await a.clientInformation()).toEqual({ client_id: 'c1' });
    expect((await b.tokens()).access_token).toBe('y');
    expect(JSON.parse(await readFile(file, 'utf8'))['https://a/mcp'].client.client_id).toBe('c1');
  });

  it('a provider with no browser hook reports "not signed in" instead of starting a sign-in', async () => {
    const p = fileAuthProvider({ serverUrl: 'https://a/mcp', file: join(await dir(), 'auth.json') });
    expect(() => p.redirectToAuthorization(new URL('https://as/authorize'))).toThrow(/strudel-mcp login/);
  });
});
