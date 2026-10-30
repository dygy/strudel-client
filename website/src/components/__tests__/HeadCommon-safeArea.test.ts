/**
 * @spec: 016-responsive-repl-layout (review #5)
 * `viewport-fit=cover` (which makes env(safe-area-inset-*) non-zero) is only set on the REPL pages,
 * whose compact bars pad themselves; every other page (login, docs) keeps the default viewport, so
 * its content never slides under the notch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'website/src');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

describe('safe-area viewport', () => {
  const head = read('components/HeadCommon.astro');

  it('HeadCommon adds viewport-fit=cover only when the page asks for it', () => {
    expect(head).toMatch(/safeAreaCover \? ', viewport-fit=cover' : ''/);
    expect(head).toContain('<meta name="viewport" content={viewport} />');
    expect(head).toContain('interactive-widget=resizes-content');
  });

  it.each(['pages/repl/[...trackPath].astro', 'pages/[userId]/repl/[...trackPath].astro'])(
    '%s (the REPL) asks for it',
    (page) => {
      expect(read(page)).toContain('<HeadCommon safeAreaCover />');
    },
  );

  it('the login page does not', () => {
    expect(read('pages/login.astro')).not.toContain('safeAreaCover');
  });
});
