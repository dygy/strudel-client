/**
 * @spec: 023-vinyl-scratch-realism (2.3, 2.5; tech §2.2, §3)
 * useReplContext wires the speakers' scratch offset (checked in its source, comments stripped,
 * like scratchReplWiring.test.ts, because rendering the hook needs the whole REPL):
 * - the main repl's editPattern runs spec 017's transition hook inside the scratch offset, so the
 *   total shift is the transition origin plus the scratch offset;
 * - the runtime gets the main repl and the transition state, so grabs are refused (and the
 *   settled lag not applied) while a switch evaluates, waits or runs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../useReplContext.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const flat = source.replace(/\s+/g, ' ');

describe('useReplContext wires the speakers scratch offset', () => {
  it('editPattern composes the transition hook inside scratchRuntime.editMainPattern', () => {
    expect(flat).toMatch(
      /editPattern: \(pattern: any\) => scratchRuntime\.editMainPattern\(pattern, \(p: any\) => transitionControllerRef\.current\?\.editPattern\(p\) \?\? p\)/,
    );
    // The old direct hook is gone (it would bypass the scratch offset).
    expect(flat).not.toMatch(
      /editPattern: \(pattern: any\) => transitionControllerRef\.current\?\.editPattern\(pattern\)/,
    );
  });

  it('the runtime gets the main repl and whether a switch is under way (any non-idle phase)', () => {
    expect(flat).toMatch(
      /scratchRuntime\.setMainRepl\(editor\.repl, \{ isBusy: \(\) => \(transitionControllerRef\.current\?\.getState\(\)\.phase \?\? 'idle'\) !== 'idle', \}\)/,
    );
  });
});
