/**
 * The user's online library (the remote MCP server at strudel.dygy.app/mcp), reached from this computer.
 *
 * The online server accepts only OAuth tokens issued to an assistant, so the helper signs in once with
 * `strudel-mcp login`: the SDK discovers the authorization server from the resource, registers a public
 * client (dynamic registration), and runs the authorization-code flow with PKCE through a one-shot
 * listener on 127.0.0.1. The tokens are kept in a file only the user can read; the transport refreshes
 * them on a 401 with the refresh token.
 *
 * Why this exists: a generated piece is tens of kilobytes. Sent through an assistant's create_track,
 * every byte of it has to be written out by the model. upload_track reads the file here instead.
 */
import { createServer as createHttpServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_LIBRARY_URL = 'https://strudel.dygy.app/mcp';
/** The online server's own limit for a track's code (create_track / update_track). */
export const MAX_TRACK_BYTES = 512 * 1024;
/** Only Strudel source is uploaded: the tool must not become a way to copy any file off this computer. */
export const UPLOAD_EXTENSIONS = ['.strudel', '.js'];

export const libraryUrl = () => process.env.STRUDEL_MCP_LIBRARY_URL || DEFAULT_LIBRARY_URL;

export function authFile() {
  const base = process.env.STRUDEL_MCP_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'strudel-mcp');
  return join(base, 'auth.json');
}

async function readStore(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStore(file, store) {
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * The SDK's OAuth client provider, backed by the auth file (one entry per library URL).
 * @param {{ serverUrl: string, file?: string, redirectUrl?: string, onAuthorizationUrl?: (url: URL) => void }} o
 */
export function fileAuthProvider(o) {
  const file = o.file ?? authFile();
  const load = async () => (await readStore(file))[o.serverUrl] ?? {};
  const save = async (patch) => {
    const store = await readStore(file);
    store[o.serverUrl] = { ...(store[o.serverUrl] ?? {}), ...patch };
    await writeStore(file, store);
  };
  return {
    get redirectUrl() {
      return o.redirectUrl;
    },
    get clientMetadata() {
      return {
        client_name: 'Strudel MCP (local helper)',
        redirect_uris: o.redirectUrl ? [o.redirectUrl] : [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },
    clientInformation: async () => (await load()).client,
    saveClientInformation: (client) => save({ client }),
    tokens: async () => (await load()).tokens,
    saveTokens: (tokens) => save({ tokens, savedAt: Date.now() }),
    codeVerifier: async () => {
      const { verifier } = await load();
      if (!verifier) throw new Error('No sign-in in progress. Run: strudel-mcp login');
      return verifier;
    },
    saveCodeVerifier: (verifier) => save({ verifier }),
    redirectToAuthorization: (url) => {
      if (!o.onAuthorizationUrl) throw new NotSignedIn();
      o.onAuthorizationUrl(url);
    },
    invalidateCredentials: async (scope) => {
      const current = await load();
      const drop = scope === 'all' ? ['client', 'tokens', 'verifier'] : scope === 'client' ? ['client'] : scope === 'tokens' ? ['tokens'] : scope === 'verifier' ? ['verifier'] : [];
      const store = await readStore(file);
      store[o.serverUrl] = Object.fromEntries(Object.entries(current).filter(([k]) => !drop.includes(k)));
      await writeStore(file, store);
    },
  };
}

export class NotSignedIn extends Error {
  constructor() {
    super('This helper is not signed in to the online library. Ask the user to run: strudel-mcp login');
    this.name = 'NotSignedIn';
  }
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed too */
  }
}

/**
 * Signs in: registers a client for a one-shot redirect listener on 127.0.0.1 and waits for the code.
 * @param {{ serverUrl?: string, file?: string, log?: (s: string) => void, open?: (url: string) => void, timeoutMs?: number }} [o]
 */
export async function login(o = {}) {
  const serverUrl = o.serverUrl ?? libraryUrl();
  const log = o.log ?? ((s) => process.stderr.write(`${s}\n`));
  const listener = createHttpServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const redirectUrl = `http://127.0.0.1:${listener.address().port}/callback`;
  const code = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out')), o.timeoutMs ?? 10 * 60 * 1000);
    listener.on('request', (req, res) => {
      const url = new URL(req.url, redirectUrl);
      if (url.pathname !== '/callback') return void res.writeHead(404).end();
      const got = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(got ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' }).end(got ? 'Signed in. You can close this tab.' : `Sign-in failed: ${error ?? 'no code'}`);
      clearTimeout(timer);
      if (got) resolve(got);
      else reject(new Error(`Sign-in failed: ${url.searchParams.get('error_description') ?? error ?? 'no code'}`));
    });
  });
  try {
    // a new listener port is a new redirect URI: register a fresh client for it
    const provider = fileAuthProvider({
      serverUrl,
      file: o.file,
      redirectUrl,
      onAuthorizationUrl: (url) => {
        log(`Opening the sign-in page. If no browser opens, visit:\n${url.href}`);
        (o.open ?? openInBrowser)(url.href);
      },
    });
    await provider.invalidateCredentials('all');
    if ((await auth(provider, { serverUrl })) === 'AUTHORIZED') return;
    const authorizationCode = await code;
    if ((await auth(provider, { serverUrl, authorizationCode })) !== 'AUTHORIZED') throw new Error('Sign-in did not complete');
    log(`Signed in to ${serverUrl}. Tokens: ${o.file ?? authFile()}`);
  } finally {
    listener.close();
  }
}

/**
 * Calls one tool of the online library with the stored sign-in.
 * @returns {Promise<any>} the tool's structured result (or its parsed text)
 */
export async function callLibrary(name, args, o = {}) {
  const serverUrl = o.serverUrl ?? libraryUrl();
  const provider = fileAuthProvider({ serverUrl, file: o.file });
  if (!(await provider.tokens())) throw new NotSignedIn();
  const client = new Client({ name: 'strudel-mcp-local', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider, fetch: o.fetch }));
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.find((c) => c.type === 'text')?.text;
    let body = r.structuredContent;
    if (body === undefined && text !== undefined) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (r.isError) {
      const error = new Error(typeof body === 'string' ? body : JSON.stringify(body));
      error.remote = body;
      throw error;
    }
    return body;
  } finally {
    await client.close();
  }
}

/**
 * Reads a Strudel file and saves it to the library: a new track, or the new code of an existing one.
 * @param {{ path: string, name?: string, folder?: string, trackId?: string }} input
 */
export async function uploadTrack(input, o = {}) {
  const call = o.call ?? ((name, args) => callLibrary(name, args, o));
  const ext = extname(input.path).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) throw new Error(`Only Strudel files (${UPLOAD_EXTENSIONS.join(', ')}) are uploaded, not ${ext || 'a file without an extension'}`);
  const info = await stat(input.path);
  if (!info.isFile()) throw new Error(`${input.path} is not a file`);
  if (info.size > MAX_TRACK_BYTES) throw new Error(`${input.path} is ${info.size} bytes; a track holds at most ${MAX_TRACK_BYTES}`);
  const code = await readFile(input.path, 'utf8');
  if (!code.trim()) throw new Error(`${input.path} is empty`);
  if (input.trackId) {
    // read first: a change names the version it read, and is refused if the user changed the track since
    const current = await call('get_track', { trackId: input.trackId });
    const args = { trackId: input.trackId, expectedVersion: current.version, code };
    if (input.name) args.name = input.name;
    return { action: 'updated', bytes: info.size, result: await call('update_track', args) };
  }
  const args = { name: input.name || basename(input.path, ext), code };
  if (input.folder) args.folder = input.folder;
  return { action: 'created', bytes: info.size, result: await call('create_track', args) };
}
