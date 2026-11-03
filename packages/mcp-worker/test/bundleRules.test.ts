/**
 * @spec: 018-strudel-mcp-server (tech 2.1)
 * What keeps the Worker inside 10 ms of CPU on Workers Free and away from the service-role key.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'packages/mcp-worker');
const sources = readdirSync(resolve(ROOT, 'src')).map((name) => ({
  name,
  text: readFileSync(resolve(ROOT, 'src', name), 'utf8'),
}));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  private: boolean;
  dependencies?: unknown;
};

/** Enough JSONC for this file: no `//` or `,}` appears inside its strings outside URLs. */
const parseJsonc = (text: string) =>
  JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')) as {
    name: string;
    routes: Array<{ pattern: string; custom_domain?: boolean }>;
    durable_objects: { bindings: Array<{ name: string; class_name: string }> };
    migrations: Array<{ new_sqlite_classes?: string[]; new_classes?: string[] }>;
    vars: Record<string, string>;
    observability: { enabled: boolean };
  };
const wranglerText = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8');
const wrangler = parseJsonc(wranglerText);

describe('the Worker bundle', () => {
  it('has no runtime dependency at all', () => {
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
  });

  it('imports only its own files', () => {
    const imports = sources.flatMap(({ text }) =>
      [...text.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)].map((match) => match[1]),
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((path) => !path.startsWith('./'))).toEqual([]);
  });

  it('never mentions the service-role key', () => {
    for (const { name, text } of [...sources, { name: 'wrangler.jsonc', text: wranglerText }]) {
      expect(`${name}: ${/service_role|SERVICE_ROLE/i.test(text)}`).toBe(`${name}: false`);
    }
  });
});

describe('wrangler.jsonc', () => {
  it('is the strudel-mcp Worker on the two path routes, with no custom domain', () => {
    expect(wrangler.name).toBe('strudel-mcp');
    expect(wrangler.routes.map((route) => route.pattern)).toEqual([
      'strudel.dygy.app/mcp*',
      'strudel.dygy.app/.well-known/oauth-protected-resource*',
    ]);
    expect(wrangler.routes.some((route) => route.custom_domain)).toBe(false);
  });

  it('declares TabRelay as a SQLite class, as Workers Free requires', () => {
    expect(wrangler.durable_objects.bindings).toEqual([{ name: 'TAB_RELAY', class_name: 'TabRelay' }]);
    expect(wrangler.migrations.flatMap((migration) => migration.new_sqlite_classes ?? [])).toEqual(['TabRelay']);
    expect(wrangler.migrations.flatMap((migration) => migration.new_classes ?? [])).toEqual([]);
  });

  it('holds the public Supabase values only', () => {
    expect(Object.keys(wrangler.vars).sort()).toEqual(['PUBLIC_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_URL']);
    expect(wrangler.vars.PUBLIC_SUPABASE_ANON_KEY).toMatch(/^sb_publishable_/);
  });

  it('has observability on, which the CPU time check depends on', () => {
    expect(wrangler.observability.enabled).toBe(true);
  });
});
