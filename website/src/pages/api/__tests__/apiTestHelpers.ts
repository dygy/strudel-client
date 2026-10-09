/**
 * Shared helpers for API route tests (spec 015, tech §2.2).
 *
 * - `supabaseFake`: one shared in-memory Supabase client. Test files wire it in with
 *   `vi.mock('@supabase/supabase-js', ...)` and call `resetSupabaseFake()` in `beforeEach`.
 *   It is a single object on purpose: `batch-import.ts` caches its client at module scope,
 *   so the fake must stay the same instance and only its state is reset.
 * - `useTestEnv()`: placeholder env via `setRuntimeEnv`. Never real keys, never the network.
 * - `apiContext()`: an APIContext-shaped object carrying the token both as a `cookie` header
 *   (batch-import, admin/users) and through `cookies.get` (bulk-create, admin/users).
 */
import { vi } from 'vitest';
import { setRuntimeEnv } from '../../../lib/server-env';

export type Row = Record<string, any>;

export interface FakeUser {
  id: string;
  email?: string | null;
}

interface FakeState {
  /** token -> user. A token missing from this map is an invalid session. */
  sessions: Map<string, FakeUser>;
  /** table -> rows returned by select (filtered by eq) */
  tables: Record<string, Row[]>;
  /** every insert, in order */
  inserts: Array<{ table: string; rows: Row[] }>;
  /** every update / upsert / delete, in order. Any entry here means an existing row could change. */
  mutations: Array<{ table: string; op: 'update' | 'upsert' | 'delete'; data?: Row | Row[] }>;
  /** auth.admin.listUsers() result */
  authUsers: Row[];
}

const state: FakeState = {
  sessions: new Map(),
  tables: {},
  inserts: [],
  mutations: [],
  authUsers: [],
};

function queryBuilder(table: string) {
  let rows: Row[] | undefined;
  let filters: Array<[string, unknown]> = [];
  let inserted: Row[] | undefined;

  const result = () => {
    if (inserted) return { data: inserted, error: null };
    const base = rows ?? state.tables[table] ?? [];
    return { data: base.filter((r) => filters.every(([k, v]) => r[k] === v)), error: null };
  };

  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      filters = [...filters, [col, val]];
      return builder;
    }),
    insert: vi.fn((data: Row | Row[]) => {
      inserted = Array.isArray(data) ? data : [data];
      state.inserts.push({ table, rows: inserted });
      return builder;
    }),
    update: vi.fn((data: Row) => {
      state.mutations.push({ table, op: 'update', data });
      return builder;
    }),
    upsert: vi.fn((data: Row | Row[]) => {
      inserted = Array.isArray(data) ? data : [data];
      state.mutations.push({ table, op: 'upsert', data });
      return builder;
    }),
    delete: vi.fn(() => {
      state.mutations.push({ table, op: 'delete' });
      return builder;
    }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}

export const supabaseFake = {
  auth: {
    getUser: vi.fn(async (token: string) => {
      const user = state.sessions.get(token);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
    }),
    admin: {
      listUsers: vi.fn(async () => ({ data: { users: state.authUsers }, error: null })),
    },
  },
  from: vi.fn((table: string) => queryBuilder(table)),
};

export const createClientMock = vi.fn((..._args: unknown[]) => supabaseFake);

export const fakeState = state;

export function resetSupabaseFake(): void {
  state.sessions = new Map();
  state.tables = {};
  state.inserts = [];
  state.mutations = [];
  state.authUsers = [];
  supabaseFake.auth.getUser.mockClear();
  supabaseFake.auth.admin.listUsers.mockClear();
  supabaseFake.from.mockClear();
  createClientMock.mockClear();
}

/** Register a valid session token for a user. */
export function signIn(token: string, user: FakeUser): void {
  state.sessions.set(token, user);
}

/** update / upsert / delete calls on `table`. */
export function mutationsOn(table: string) {
  return state.mutations.filter((m) => m.table === table);
}

/** Rows inserted into `table` across all insert calls. */
export function insertedInto(table: string): Row[] {
  return state.inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
}

export function useTestEnv(): void {
  setRuntimeEnv({ PUBLIC_SUPABASE_URL: 'http://test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
}

/** Drop the placeholder env so it can't leak into other files under `isolate: false`. */
export function clearTestEnv(): void {
  setRuntimeEnv({});
}

export interface ApiContextOptions {
  url: string;
  method?: string;
  /** access token; omitted means signed out */
  token?: string;
  /** JSON-serialised as the request body */
  body?: unknown;
  /** sent verbatim instead of `body` (e.g. unparseable JSON) */
  rawBody?: string;
}

export function apiContext({ url, method = 'GET', token, body, rawBody }: ApiContextOptions): any {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.cookie = `sb-access-token=${token}`;
  const request = new Request(url, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const jar: Record<string, string> = token ? { 'sb-access-token': token } : {};
  return {
    request,
    url: new URL(url),
    cookies: {
      get: (k: string) => (k in jar ? { value: jar[k] } : undefined),
    },
  };
}
