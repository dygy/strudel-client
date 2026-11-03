/**
 * @spec: 018-strudel-mcp-server (tech 2.1)
 * What keeps the Worker inside 10 ms of CPU on Workers Free and away from the service-role key.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'packages/mcp-worker');
const sources = readdirSync(resolve(ROOT, 'src'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map(({ name }) => ({
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
  it('depends on acorn and nothing else at runtime: no SDK, zod or supabase-js', () => {
    expect(pkg.private).toBe(true);
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['acorn']);
  });

  it('imports only its own files, acorn, the mini parser and the pure rules the site uses', () => {
    const imports = sources.flatMap(({ text }) =>
      [...text.matchAll(/(?:from\s+|import\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)].map((match) => match[1]),
    );
    expect(imports.length).toBeGreaterThan(0);
    const allowed = [
      'acorn',
      '../../mini/krill-parser.js',
      '../../../website/src/lib/multitrack',
      '../../../website/src/lib/slugUtils',
      '../../../website/src/lib/trackRename',
    ];
    expect(imports.filter((path) => !path.startsWith('./') && !allowed.includes(path))).toEqual([]);
  });

  it('pulls in nothing else through those site files', () => {
    const relevant = ['multitrack', 'slugUtils', 'trackRename'];
    for (const name of relevant) {
      const text = readFileSync(resolve(ROOT, '../../website/src/lib', `${name}.ts`), 'utf8');
      const imports = [...text.matchAll(/^import\s+(?!type)[^;]*from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);
      expect(`${name}: ${imports.filter((path) => !path.startsWith('./'))}`).toBe(`${name}: `);
    }
  });

  it('never mentions the service-role key', () => {
    for (const { name, text } of [...sources, { name: 'wrangler.jsonc', text: wranglerText }]) {
      expect(`${name}: ${/service_role|SERVICE_ROLE/i.test(text)}`).toBe(`${name}: false`);
    }
  });
});

describe('the deploy workflow', () => {
  const workflow = readFileSync(resolve(ROOT, '../../.github/workflows/deploy.yml'), 'utf8');
  const deployJob = workflow.slice(workflow.indexOf('  deploy:'));
  const steps = deployJob.split(/\n {6}- /);
  const indexOf = (text: string) => steps.findIndex((step) => step.includes(text));

  it('deploys strudel-mcp after strudel-client, which its service binding needs', () => {
    const site = indexOf('workingDirectory: website');
    const mcp = indexOf('workingDirectory: packages/mcp-worker');
    expect(site).toBeGreaterThan(0);
    expect(mcp).toBeGreaterThan(site);
    expect(steps[mcp]).toContain('command: deploy');
  });

  it('builds the knowledge data from this commit first, using the doc.json the site build made', () => {
    expect(indexOf('pnpm run build:cloudflare')).toBeLessThan(indexOf('build-knowledge.mjs'));
    expect(indexOf('build-knowledge.mjs')).toBeLessThan(indexOf('workingDirectory: packages/mcp-worker'));
  });

  it('deploys only after the checks, with the same token', () => {
    expect(deployJob).toContain('needs: check');
    expect(steps[indexOf('workingDirectory: packages/mcp-worker')]).toContain('secrets.CLOUDFLARE_API_TOKEN');
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
