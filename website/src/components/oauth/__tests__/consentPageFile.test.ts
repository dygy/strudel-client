/**
 * @spec: 018-strudel-mcp-server (tech 2.1, 2.3)
 * The page stays out of the Worker bundle, its URL stays away from the analytics script, and it
 * can't be framed by another site to trick a click on Allow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEBSITE = resolve(process.cwd(), 'website');
const page = readFileSync(resolve(WEBSITE, 'src/pages/oauth/consent.astro'), 'utf8');
const headers = readFileSync(resolve(WEBSITE, 'public/_headers'), 'utf8');

describe('/oauth/consent', () => {
  it('is prerendered, with a client-only island', () => {
    expect(page).toContain('export const prerender = true;');
    expect(page).toContain('client:only="react"');
  });

  it('has no analytics in its head, because its URL holds the authorization id', () => {
    expect(page).not.toMatch(/^import .*HeadCommon/m);
  });

  it('refuses to be framed, and sends no Referer', () => {
    const rule = headers.split('/oauth/consent*')[1];
    expect(rule).toContain('X-Frame-Options: DENY');
    expect(rule).toContain("frame-ancestors 'none'");
    expect(rule).toContain('Referrer-Policy: no-referrer');
  });
});
