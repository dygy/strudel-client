/**
 * @spec: 022-set-playlist (2.3 Update while cued, cancelling a cue; tech §2.4)
 * useReplContext wires the set bridge where it must (checked in its source, comments stripped, like
 * scratchReplWiring.test.ts: rendering useReplContext would re-import the whole REPL under mocks):
 * - Update (handleEvaluate) asks the set player first, before it stops the preview or updates;
 * - afterEval tells the bridge what plays (a Go moves on as soon as its code lands);
 * - the preview's own stop button fires the bridge's cancel event;
 * - the bridge's switch is runUpdate itself (trackSwitch.update → evaluateNewTrack), never repl.evaluate;
 * - a recreated track is announced to the sets.
 * And the file manager publishes the step open next to the track open, never read-only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (path: string) => strip(readFileSync(resolve(process.cwd(), path), 'utf8'));

const repl = read('website/src/repl/useReplContext.tsx');
const fileManager = read('website/src/repl/components/sidebar/FileManagerRefactored.tsx');

/** The source from `start` up to (not including) `end`. */
function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('useReplContext wires the set bridge', () => {
  it('Update while cued is the set Go: handleEvaluate routes to it before anything else', () => {
    const body = between(repl, 'const handleEvaluate = async', 'await runUpdate();');
    const route = body.indexOf('setBridgeRef.current?.routeUpdate()');
    expect(route).toBeGreaterThan(-1);
    expect(route).toBeLessThan(body.indexOf('scratchHooks.beforeEvaluate();'));
    expect(route).toBeLessThan(body.indexOf('mixerRef.current.stop()'));
    expect(body).toMatch(/if \(setBridgeRef\.current\?\.routeUpdate\(\)\) return;/);
  });

  it('afterEval tells the bridge which code now plays', () => {
    expect(between(repl, 'afterEval: (all: any) => {', 'setLatestCode(code);')).toContain(
      'setBridgeRef.current?.evaluated(code);',
    );
  });

  it("the preview's own stop button fires the bridge's cancel event", () => {
    const toggle = between(repl, 'const handlePreviewToggle = async', "console.error('[Preview] Failed to toggle:'");
    // In the stop branch, after the engine stopped (never in the start branch).
    expect(toggle).toMatch(
      /engine\.stop\(\);\s*setIsPreviewing\(false\);[\s\S]*setBridgeRef\.current\?\.previewStoppedByUser\(\);/,
    );
    expect(toggle.indexOf('previewStoppedByUser')).toBeGreaterThan(toggle.indexOf('engine.stop();'));
  });

  it('the bridge switches through runUpdate (force + transition), never repl.evaluate', () => {
    const bridge = between(repl, 'setBridgeRef.current = createSetBridge({', 'const setBridge = setBridgeRef.current;');
    expect(bridge).toMatch(/runSwitch: async \(options\) => \{[\s\S]*runUpdateRef\.current\(options,/);
    expect(bridge).not.toContain('.evaluate(');
    // runUpdate hands force and transition to the switch it starts.
    const update = between(repl, 'const runUpdate = async', 'const handleEvaluate = async');
    expect(update).toMatch(/trackSwitch\.update\(\{[\s\S]*force,/);
    expect(update).toMatch(/evaluateNewTrack\(code, \{[\s\S]*transition,/);
    // Review 022 #1: only a set Go (force) keeps the old track when the new one fails.
    expect(update).toMatch(/evaluateNewTrack\(code, \{[\s\S]*keepOldOnFailure: force,/);
  });

  it('Play with an item cued still means the speakers', () => {
    expect(between(repl, 'const handleTogglePlay = async', 'editorRef.current?.toggle();')).toContain(
      'bridge.evaluateOnSpeakers()',
    );
  });

  it('a recreated track is announced to the sets as well as to the track switch', () => {
    const remap = between(repl, 'const replaceTrackId = useCallback(', '[trackSwitch],');
    expect(remap).toContain('trackSwitch.replaceTrackId(oldId, newId);');
    expect(remap).toContain('announceTrackIdReplaced(oldId, newId);');
    expect(repl).toMatch(/\n\s+replaceTrackId,\n/);
  });
});

describe('the sets flush on pagehide synchronously (review 022 #4)', () => {
  const useSets = read('website/src/repl/sets/useSets.ts');
  it('pagehide calls flushOnUnload (keepalive, no await), not the awaited flush', () => {
    const effect = between(useSets, 'const flush = () =>', "window.removeEventListener('pagehide', flush)");
    expect(effect).toContain('store.flushOnUnload()');
    expect(effect).not.toMatch(/store\.flush\(\)/);
  });
});

describe('the cue failure toasts are wired (review 022 #3)', () => {
  const player = read('website/src/repl/sets/useSetPlayer.tsx');
  it('every reason has a toast key, and the controller gets onCueFailed and onGoIgnored', () => {
    expect(player).toMatch(/'no-library': 'setListCueNoLibrary'/);
    expect(player).toMatch(/'no-preview': 'setListCueNoPreview'/);
    expect(player).toMatch(/failed: 'setListCueFailed'/);
    expect(player).toMatch(/onCueFailed: \(reason\) =>/);
    expect(player).toMatch(/onGoIgnored: \(\) =>[\s\S]*setListGoIgnored/);
  });
});

describe('the file manager publishes the step open (tech §2.4)', () => {
  it('next to the track open, and not in the read-only view', () => {
    const effect = between(
      fileManager,
      'React.useEffect(() => {\n    if (readOnly) return undefined;',
      '}, [readOnly]);',
    );
    expect(effect).toContain('registerTrackSelect(');
    expect(effect).toMatch(
      /registerStepSelect\(\(\{ trackId, stepIndex \}\) => switchStepRef\.current\(trackId, stepIndex\)\)/,
    );
    expect(effect).toContain('registerStepSelect(null);');
  });
});
