/**
 * @spec: 019-vinyl-scratch-control (2.6; review findings #3 and #7)
 * The REPL lets go of the platter on every path that starts, stops, evaluates or switches.
 *
 * 1. Behaviour: the release hooks on the real core repl. Its beforeEval runs on every evaluate
 *    (Play, Ctrl+Enter, Update, Shuffle, a transition's evaluate, the assistant's start), its
 *    onToggle on every start and stop, so wrapping those two covers all of them.
 * 2. Wiring: useReplContext calls each hook where it must (checked in its source, comments
 *    stripped): the main repl's options are wrapped, an Update or switch lets go when it begins,
 *    Update lets go before it stops the preview, and stopping the preview lets go of its deck.
 *
 * Rendering useReplContext itself would need the whole REPL re-imported under mocks, which made
 * the suite three times slower (see the 019 flow log), so the wiring is checked at this seam.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repl, silence } from '@strudel/core';
import { createScratchReplHooks } from '../scratch/scratchReplHooks';

let events: string[] = [];
const runtime = { releaseAll: () => events.push('releaseAll') };
const hooks = createScratchReplHooks(runtime);
let live: ReturnType<typeof repl> | null = null;

function mainRepl() {
  const options = hooks.replOptions({
    defaultOutput: () => {},
    getTime: () => 0,
    beforeEval: async () => {
      events.push('beforeEval');
    },
    onToggle: (playing: boolean) => {
      events.push(`onToggle:${playing}`);
    },
  });
  live = repl(options as Parameters<typeof repl>[0]);
  return live;
}

afterEach(() => {
  live?.stop();
  live = null;
  events = [];
});

describe('release hooks on the real core repl', () => {
  it('every evaluate (Play, Ctrl+Enter, Update, Shuffle, transitions) lets go before the code runs', async () => {
    const main = mainRepl();
    await main.evaluate('silence', false);
    expect(events.slice(0, 2)).toEqual(['releaseAll', 'beforeEval']);
  });

  it('every start and stop lets go', async () => {
    const main = mainRepl();
    await main.setPattern(silence, false);
    await main.start();
    expect(events).toEqual(['releaseAll', 'onToggle:true']);
    events = [];
    main.stop();
    expect(events).toEqual(['releaseAll', 'onToggle:false']);
  });

  it('the wrapped options keep everything else, and work without their own hooks', () => {
    const defaultOutput = () => {};
    const wrapped = hooks.replOptions({ defaultOutput, onToggle: undefined });
    expect(wrapped.defaultOutput).toBe(defaultOutput);
    expect(() => wrapped.onToggle?.(false)).not.toThrow();
    expect(events).toEqual(['releaseAll']);
  });

  it('beforeUpdate and beforeEvaluate let go; previewStopping lets go of the preview deck', () => {
    hooks.beforeUpdate();
    hooks.beforeEvaluate();
    hooks.previewStopping({ scratchDeck: { release: () => events.push('previewDeck.release') } });
    expect(events).toEqual(['releaseAll', 'releaseAll', 'previewDeck.release']);
    // Before the preview deck exists (it is created when the preview plays): nothing to do.
    expect(() => hooks.previewStopping({ scratchDeck: null })).not.toThrow();
    expect(() => hooks.previewStopping(null)).not.toThrow();
  });
});

describe('useReplContext calls every release hook where it must', () => {
  const source = readFileSync(resolve(process.cwd(), 'website/src/repl/useReplContext.tsx'), 'utf8')
    // Comments don't count: a commented-out call is a removed call.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** The source from `start` up to (not including) `end`. */
  const between = (start: string, end: string) => {
    const from = source.indexOf(start);
    expect(from, `${start} not found`).toBeGreaterThan(-1);
    const to = source.indexOf(end, from);
    expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it('the main repl (StrudelMirror) gets the wrapped options: onToggle and beforeEval let go', () => {
    expect(source).toMatch(/new StrudelMirror\(\s*scratchHooks\.replOptions\(\{/);
    expect(source).toMatch(/const scratchHooks = createScratchReplHooks\(scratchRuntime\)/);
  });

  it('an Update or a track switch lets go when it begins (runUpdate, before trackSwitch.update)', () => {
    expect(between('const runUpdate = async', 'trackSwitch.update(')).toContain('scratchHooks.beforeUpdate();');
  });

  it('Update lets go before it stops the headphone preview (handleEvaluate)', () => {
    expect(between('const handleEvaluate = async', 'mixerRef.current.stop()')).toContain(
      'scratchHooks.beforeEvaluate();',
    );
  });

  it('stopping the headphone preview lets go of its deck first (handlePreviewToggle)', () => {
    expect(between('const handlePreviewToggle = async', 'setIsPreviewing(false)')).toMatch(
      /scratchHooks\.previewStopping\(engine\);\s*engine\.stop\(\);/,
    );
  });
});
