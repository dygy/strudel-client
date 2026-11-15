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

describe('callLibrary', () => {
  it('refreshes an expired access token with the stored refresh token instead of failing', async () => {
    // Before the fix the provider had no redirect URL, so the SDK took the flow for a non-interactive one and never
    // tried the refresh grant: every call failed an hour after sign-in ("Either provider.prepareTokenRequest() or
    // authorizationCode is required").
    const { createServer } = await import('node:http');
    const { callLibrary } = await import('../src/library.mjs');
    const seen = { refresh: 0, calls: 0 };
    const srv = createServer(async (req, res) => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const json = (code, body, headers = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      let raw = '';
      for await (const c of req) raw += c;
      if (req.url.startsWith('/.well-known/oauth-protected-resource')) {
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      }
      if (
        req.url.startsWith('/.well-known/oauth-authorization-server') ||
        req.url.startsWith('/.well-known/openid-configuration')
      ) {
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (req.url === '/token') {
        const p = new URLSearchParams(raw);
        if (p.get('grant_type') !== 'refresh_token' || p.get('refresh_token') !== 'OLD')
          return json(400, { error: 'invalid_grant' });
        seen.refresh++;
        return json(200, { access_token: 'NEW', token_type: 'bearer', expires_in: 3600, refresh_token: 'R2' });
      }
      if (req.url === '/mcp') {
        if (req.headers.authorization !== 'Bearer NEW') {
          return json(
            401,
            { error: 'invalid_token' },
            {
              'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            },
          );
        }
        const msg = JSON.parse(raw);
        if (msg.id === undefined) return void res.writeHead(202).end();
        if (msg.method === 'initialize') {
          return json(200, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: msg.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'fake', version: '1' },
            },
          });
        }
        seen.calls++;
        return json(200, {
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } },
        });
      }
      res.writeHead(404).end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${srv.address().port}`;
      const file = join(await dir(), 'auth.json');
      await writeFile(
        file,
        JSON.stringify({
          [`${base}/mcp`]: {
            client: { client_id: 'c1', redirect_uris: ['http://127.0.0.1:9/callback'], issuer: base },
            tokens: { access_token: 'EXPIRED', token_type: 'bearer', refresh_token: 'OLD', issuer: base },
          },
        }),
      );
      expect(await callLibrary('list_folders', {}, { serverUrl: `${base}/mcp`, file })).toEqual({ ok: true });
      expect(seen).toEqual({ refresh: 1, calls: 1 });
      expect(JSON.parse(await readFile(file, 'utf8'))[`${base}/mcp`].tokens.refresh_token).toBe('R2'); // rotated, kept
    } finally {
      srv.close();
    }
  });
});
