/**
 * The browser side of `/api/sets/*` (spec 022, tech §2.2). Same Bearer-header approach as
 * `lib/secureApi.ts`: a valid session's access token in `Authorization`, one refresh-and-retry on a
 * 401. Writes to one set are serialized, so two quick edits can't race each other on the server,
 * and the version each write names is read when it is SENT (after the previous one landed).
 */
import type { SetItem, SetList } from '../../lib/setLists';

/** A refused request. `code` is the API's `error` (e.g. `name_taken`, `version_conflict`). */
export class SetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** On `version_conflict`: the set as it is on the server now. */
    readonly current?: SetList,
  ) {
    super(message);
    this.name = 'SetsApiError';
  }
}

/** Browsers refuse a keepalive body over 64 KiB (the same margin as lib/secureApi.ts). */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export interface SetsApiDeps {
  fetch?: typeof fetch;
  /** The access token of a valid session, refreshing it when needed; null when signed out. */
  getAccessToken?: () => Promise<string | null>;
  baseUrl?: string;
}

export interface SetChanges {
  name?: string;
  items?: SetItem[];
}

async function defaultAccessToken(): Promise<string | null> {
  const { ensureValidSession } = await import('../../lib/authUtils');
  const result = await ensureValidSession();
  return result.success ? (result.session?.access_token ?? null) : null;
}

/** A client for the sets API. `deps` exist for tests; the app uses the default `setsApi`. */
export function createSetsApi(deps: SetsApiDeps = {}) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const getAccessToken = deps.getAccessToken ?? defaultAccessToken;
  const baseUrl = () => deps.baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  // set id -> the last write queued for it
  const chains = new Map<string, Promise<unknown>>();
  // The token of the last request: a page that is going away can't wait for a session check.
  let cachedToken: string | null = null;

  async function request<T>(path: string, method: string, body?: unknown, retried = false): Promise<T> {
    const token = await getAccessToken();
    if (!token) throw new SetsApiError('Not signed in', 401, 'not_authenticated');
    cachedToken = token;
    const response = await doFetch(`${baseUrl()}/api/sets/${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 401 && !retried) return request<T>(path, method, body, true);
    if (!response.ok) {
      const code = typeof data.error === 'string' ? data.error : null;
      throw new SetsApiError(code ?? `HTTP ${response.status}`, response.status, code, data.current as SetList);
    }
    return data as T;
  }

  /** Run `task` after every write already queued for `id`, whether those succeeded or not. */
  function serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    chains.set(id, next);
    const forget = () => {
      if (chains.get(id) === next) chains.delete(id);
    };
    next.then(forget, forget);
    return next;
  }

  return {
    /** The signed-in user's sets, ordered by name. */
    async list(): Promise<SetList[]> {
      const { sets } = await request<{ sets: SetList[] }>('list', 'GET');
      return sets;
    },
    /** A new empty set. Throws SetsApiError `name_taken` when the name is in use. */
    async create(name?: string): Promise<SetList> {
      const { set } = await request<{ set: SetList }>('create', 'POST', name === undefined ? {} : { name });
      return set;
    },
    /**
     * Rename and/or replace the items of set `id`. `expectedVersion` is read when the write is sent,
     * so a write queued behind another one names the version that one produced.
     */
    update(id: string, changes: SetChanges, expectedVersion: string | (() => string)): Promise<SetList> {
      return serialize(id, async () => {
        const version = typeof expectedVersion === 'function' ? expectedVersion() : expectedVersion;
        const { set } = await request<{ set: SetList }>('update', 'PUT', { id, ...changes, expectedVersion: version });
        return set;
      });
    },
    /**
     * The page is going away (pagehide): send the change NOW, in this call, like
     * secureApi.saveOnUnload. No await before the fetch (no session check, no queue), `keepalive`
     * so the browser finishes it after the page is gone, the cached token plus the session cookie.
     * `'too-large'`: over the browser's keepalive limit; the caller falls back to a normal save.
     */
    sendOnUnload(id: string, changes: SetChanges, expectedVersion: string): 'sent' | 'too-large' {
      const body = JSON.stringify({ id, ...changes, expectedVersion });
      if (new TextEncoder().encode(body).length > KEEPALIVE_MAX_BYTES) return 'too-large';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cachedToken) headers.Authorization = `Bearer ${cachedToken}`;
      try {
        void Promise.resolve(
          doFetch(`${baseUrl()}/api/sets/update`, {
            method: 'PUT',
            keepalive: true,
            credentials: 'include',
            headers,
            body,
          }),
        ).catch((error: unknown) => console.warn('[sets] save on unload failed:', error));
      } catch (error: unknown) {
        console.warn('[sets] save on unload failed:', error);
      }
      return 'sent';
    },

    /** Delete set `id` (never its tracks). */
    remove(id: string): Promise<void> {
      return serialize(id, async () => {
        await request<{ ok: true }>('delete', 'DELETE', { id });
      });
    },
  };
}

export type SetsApi = ReturnType<typeof createSetsApi>;

/** The app's client. */
export const setsApi = createSetsApi();
