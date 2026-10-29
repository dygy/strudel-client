/**
 * Login page auto-return (LoginPage.tsx -> lib/loginResume.ts). A user sent to /login because the
 * server rejected a stale cookie, but whose client session is alive, goes straight back, after a
 * FORCED refresh: the local clock may be slow, so "not expired yet" locally proves nothing.
 * Never twice within 30 s (no redirect loop), never with ?error, never without a client session.
 */
import { describe, expect, it, vi } from 'vitest';
import { resumeSessionFromLogin, type LoginResumeDeps } from '../loginResume';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function deps(overrides: Partial<LoginResumeDeps> = {}) {
  const d = {
    search: '?redirect=%2Frepl%2Fdrums%2Fbeat',
    storage: memoryStorage(),
    hasClientSession: vi.fn(async () => true),
    forceRefresh: vi.fn(async () => ({ success: true, session: { access_token: 'eyJ.fresh.token' } })),
    writeCookie: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
  return d;
}

describe('resumeSessionFromLogin', () => {
  it('force-refreshes, rewrites the cookie and returns to ?redirect=', async () => {
    const d = deps();

    await expect(resumeSessionFromLogin(d)).resolves.toBe(true);

    expect(d.forceRefresh).toHaveBeenCalledTimes(1);
    expect(d.writeCookie).toHaveBeenCalledWith({ access_token: 'eyJ.fresh.token' });
    expect(d.navigate).toHaveBeenCalledWith('/repl/drums/beat');
  });

  it('a second bounce within the window shows the login page instead of looping', async () => {
    const storage = memoryStorage();
    const first = deps({ storage });
    const second = deps({ storage });

    await resumeSessionFromLogin(first);
    await expect(resumeSessionFromLogin(second)).resolves.toBe(false);

    expect(second.navigate).not.toHaveBeenCalled();
    expect(second.forceRefresh).not.toHaveBeenCalled();
  });

  it('stays on /login when it was opened with ?error', async () => {
    const d = deps({ search: '?error=no_session&redirect=%2Frepl' });

    await expect(resumeSessionFromLogin(d)).resolves.toBe(false);
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('stays on /login without a client session', async () => {
    const d = deps({ hasClientSession: vi.fn(async () => false) });

    await expect(resumeSessionFromLogin(d)).resolves.toBe(false);
    expect(d.forceRefresh).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('stays on /login when the forced refresh fails', async () => {
    const d = deps({ forceRefresh: vi.fn(async () => ({ success: false })) });

    await expect(resumeSessionFromLogin(d)).resolves.toBe(false);
    expect(d.writeCookie).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it('never returns off-site, whatever ?redirect= says', async () => {
    const d = deps({ search: '?redirect=https%3A%2F%2Fevil.test%2F' });

    await resumeSessionFromLogin(d);
    expect(d.navigate).toHaveBeenCalledWith('/repl');
  });
});
