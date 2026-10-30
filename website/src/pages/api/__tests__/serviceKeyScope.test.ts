/**
 * The service-role key bypasses RLS. It belongs to the admin surfaces only; user routes and
 * pages act as the user through api/_userClient.ts (anon key + the user's token), so RLS
 * (auth.uid() = user_id on tracks and folders, checked on prod 2026-10-30) applies.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'website/src');

/** Files allowed to read the service-role key, and why. */
const ALLOWED: Record<string, string> = {
  'lib/server-env.ts': 'defines serverEnv()',
  'env.d.ts': 'type declaration',
  'pages/api/admin/users.ts': 'admin: lists every user',
  'pages/admin.astro': 'admin dashboard',
  'pages/[userId]/repl/[...trackPath].astro': "admin: reads another user's library after isAdmin()",
  'pages/api/auth/callback.ts': 'OAuth code exchange (sign-in; not a data query)',
  'lib/database/migrate-to-tree.ts': 'one-off migration script, not served',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|astro|mjs)$/.test(name) ? [path] : [];
  });
}

describe('service-role key scope', () => {
  it('only the admin surfaces read the service-role key', () => {
    const users = files(SRC)
      .filter((f) => /supabaseServiceKey|SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(users.filter((f) => !(f in ALLOWED))).toEqual([]);
  });
});
