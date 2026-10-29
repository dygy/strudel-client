/**
 * A signed-out (or expired-cookie) visitor goes to /login?redirect=<the page they were on>, and the
 * login page returns a user whose client session is still valid back there without user action,
 * but never twice within 30 s, so a page that keeps rejecting the session can't loop.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_RESUME_WINDOW_MS,
  claimAutoResume,
  loginUrlFor,
  redirectTargetFromSearch,
  safeRedirectPath,
} from '../authRedirect';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('loginUrlFor / safeRedirectPath', () => {
  it('keeps the original path and query in ?redirect=', () => {
    expect(loginUrlFor('/repl/drums/beat/intro?x=1')).toBe('/login?redirect=%2Frepl%2Fdrums%2Fbeat%2Fintro%3Fx%3D1');
  });

  it.each([
    'https://evil.test/x',
    '//evil.test/x',
    '/\\evil.test',
    'repl',
    '/login',
    '/login?redirect=%2Frepl',
    '/auth/callback',
  ])('refuses %s (off-site or a redirect loop)', (raw) => {
    expect(safeRedirectPath(raw)).toBe('/repl');
    expect(loginUrlFor(raw)).toBe('/login');
  });

  it('reads ?redirect=, then the legacy ?track=, else /repl', () => {
    expect(redirectTargetFromSearch('?redirect=%2Frepl%2Fa%2Fb')).toBe('/repl/a/b');
    expect(redirectTargetFromSearch('?redirect=https%3A%2F%2Fevil.test')).toBe('/repl');
    expect(redirectTargetFromSearch('?track=abc')).toBe('/repl/abc');
    expect(redirectTargetFromSearch('')).toBe('/repl');
  });
});

describe('claimAutoResume (login page loop guard)', () => {
  it('allows one automatic return, then refuses within the window', () => {
    const storage = memoryStorage();
    const t0 = 1_000_000;

    expect(claimAutoResume(storage, '?redirect=%2Frepl', t0)).toBe(true);
    expect(claimAutoResume(storage, '?redirect=%2Frepl', t0 + 1000)).toBe(false);
    expect(claimAutoResume(storage, '?redirect=%2Frepl', t0 + AUTO_RESUME_WINDOW_MS - 1)).toBe(false);
    expect(claimAutoResume(storage, '?redirect=%2Frepl', t0 + AUTO_RESUME_WINDOW_MS)).toBe(true);
  });

  it('never auto-returns when /login was opened with an error', () => {
    expect(claimAutoResume(memoryStorage(), '?error=no_session&redirect=%2Frepl', 1)).toBe(false);
  });

  it('refuses when storage is unavailable (no way to guard against a loop)', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(claimAutoResume(broken, '', 1)).toBe(false);
  });
});
