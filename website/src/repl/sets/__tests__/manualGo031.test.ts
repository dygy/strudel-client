/**
 * @spec: 031-midi-mapping (§2.5 manual crossfader with a set; tech §2.6 manualGo path)
 * - setPlayerController.manualGo: the set stays `going` while the fader mixes; complete moves the set
 *   on (Now = the cued item) as Go does; abandon keeps the item cued and restarts the cue on the
 *   headphones like a fresh Cue; a press during the mix hands it to the timed transition.
 * - setBridge.manualGo: `go`'s preview stop and forced switch, as a manual mix; resolves on the end
 *   of the mix, not when the new code starts playing.
 * - evaluateNewTrack `manual`: always the controller's beginManual while playing (never the instant
 *   path, never queued), with its outcomes mapped.
 * - trackSwitch.restorePlaying: an abandoned mix's old track plays again for Update's decision.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSetPlayerController } from '../setPlayerController';
import { createSetBridge, type ManualGoOutcome, type ManualGoResult, type SetBridgeDeps } from '../setBridge';
import type { PlayerSet } from '../setPlayer';
import { evaluateNewTrack, type EvaluateNewTrackDeps, type SwitchResult } from '../../evaluateNewTrack';
import { runRestoringAbandon } from '../../abandonedMix';
import { createTrackSwitchController } from '../../trackSwitch';
import { DEFAULT_TRANSITION } from '../../transitionSettings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function playerSetup() {
  const set: PlayerSet = {
    id: 's1',
    items: [
      { id: 'a', trackId: 't1', transition: null },
      { id: 'b', trackId: 't2', transition: { type: 'filterSweep', length: 8 } },
    ],
  };
  const tracks = { t1: { id: 't1', name: 'One' }, t2: { id: 't2', name: 'Two' } };
  const calls: string[] = [];
  let manual = deferred<ManualGoOutcome>();
  const bridge = {
    openItem: vi.fn(async () => 'opened' as const),
    cue: vi.fn(async () => {
      calls.push('cue');
      return 'playing' as const;
    }),
    go: vi.fn(async () => 'switched' as const),
    manualGo: vi.fn((transition: unknown) => {
      calls.push(`manualGo:${JSON.stringify(transition)}`);
      return manual.promise;
    }),
    handOverManual: vi.fn(() => false), // true only while a manual mix runs
    stopPreview: vi.fn(() => calls.push('stopPreview')),
    redirectEditorToPreview: vi.fn(() => {
      calls.push('redirect');
      return () => calls.push('unredirect');
    }),
    removeRedirect: vi.fn(),
    onPreviewStopped: vi.fn(() => () => {}),
    setGoHandler: vi.fn(),
  };
  const cueFailed = vi.fn();
  const goIgnored = vi.fn();
  const controller = createSetPlayerController({
    bridge: bridge as never,
    getSet: (id) => (id === set.id ? set : null),
    getTracks: () => tracks,
    onCueFailed: cueFailed,
    onGoIgnored: goIgnored,
  });
  // The bridge captured the cued code as the Go began; the editor may hold something else by now.
  const end = async (result: ManualGoResult, code = 'cued item code') => {
    manual.resolve({ result, code });
    await flush();
    manual = deferred<ManualGoOutcome>();
  };
  return { controller, bridge, calls, end, cueFailed, goIgnored };
}

async function cueSecondItem(controller: ReturnType<typeof playerSetup>['controller']) {
  controller.start('s1', 'b');
  await controller.press(); // Cue b
  expect(controller.getState().phase).toBe('cued');
}

describe('setPlayerController.manualGo', () => {
  it('nothing cued: none, and no switch starts', async () => {
    const { controller, bridge } = playerSetup();
    controller.start('s1');
    expect(await controller.manualGo()).toBe('none');
    expect(bridge.manualGo).not.toHaveBeenCalled();
  });

  it('going while the fader mixes, with the item’s transition; complete moves the set on', async () => {
    const { controller, bridge, end } = playerSetup();
    await cueSecondItem(controller);
    const done = controller.manualGo();
    expect(controller.getState().phase).toBe('going');
    expect(bridge.manualGo).toHaveBeenCalledWith({ type: 'filterSweep', length: 8 });
    await end('switched');
    expect(await done).toBe('switched');
    expect(controller.getState()).toMatchObject({ phase: 'idle', nowItemId: 'b', cuedItemId: null, nextItemId: null });
  });

  it('abandoned: still cued, and the cued item’s code (not the editor’s) restarts on the headphones', async () => {
    const { controller, bridge, calls, end } = playerSetup();
    await cueSecondItem(controller);
    calls.length = 0;
    bridge.cue.mockClear();
    const done = controller.manualGo();
    await end('abandoned', 'cued item code');
    expect(await done).toBe('abandoned');
    expect(controller.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'b', nowItemId: null });
    expect(calls).toEqual(['unredirect', 'manualGo:{"type":"filterSweep","length":8}', 'cue', 'redirect']);
    expect(bridge.cue).toHaveBeenCalledWith('cued item code');
  });

  it('cancelled (Stop during the mix): still cued, no toast, the headphones stay off', async () => {
    const { controller, bridge, end, goIgnored, cueFailed } = playerSetup();
    await cueSecondItem(controller);
    bridge.cue.mockClear();
    const done = controller.manualGo();
    await end('cancelled');
    expect(await done).toBe('cancelled');
    expect(controller.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'b' });
    expect(goIgnored).not.toHaveBeenCalled();
    expect(cueFailed).not.toHaveBeenCalled();
    expect(bridge.cue).not.toHaveBeenCalled();
  });

  it('negative: an ignored manual Go still says Still switching', async () => {
    const { controller, end, goIgnored } = playerSetup();
    await cueSecondItem(controller);
    void controller.manualGo();
    await end('ignored');
    expect(goIgnored).toHaveBeenCalledTimes(1);
  });

  it('with no set playing, a press still hands an editor-path manual mix over', async () => {
    const { controller, bridge } = playerSetup();
    bridge.handOverManual.mockReturnValue(true);
    await controller.press();
    expect(bridge.handOverManual).toHaveBeenCalledTimes(1);
  });

  it('abandoned but the headphones can’t restart: the cue is cancelled with the Cue failure toast', async () => {
    const { controller, bridge, end, cueFailed } = playerSetup();
    await cueSecondItem(controller);
    bridge.cue.mockResolvedValueOnce('no-preview' as never);
    void controller.manualGo();
    await end('abandoned');
    expect(controller.getState()).toMatchObject({ phase: 'idle', cuedItemId: null, nextItemId: 'b' });
    expect(cueFailed).toHaveBeenCalledWith('no-preview');
  });

  it('a press (Cue/Go, Alt+Shift+N) during the mix hands it to the timed transition, nothing else', async () => {
    const { controller, bridge } = playerSetup();
    await cueSecondItem(controller);
    void controller.manualGo();
    bridge.handOverManual.mockClear();
    bridge.handOverManual.mockReturnValue(true);
    await controller.press();
    expect(bridge.handOverManual).toHaveBeenCalledTimes(1);
    expect(bridge.go).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe('going');
  });

  it('negative: a press while a timed Go runs (no manual mix) is ignored as before', async () => {
    const { controller, bridge } = playerSetup();
    await cueSecondItem(controller);
    bridge.go.mockReturnValue(new Promise(() => {}) as never);
    void controller.press(); // Go
    await controller.press();
    expect(bridge.go).toHaveBeenCalledTimes(1);
  });
});

function bridgeSetup(runSwitch: SetBridgeDeps['runSwitch']) {
  const engine = { isInitialized: true, evaluate: vi.fn(async () => undefined), stop: vi.fn() };
  let previewing = true;
  const editor = { code: 'new', evaluate: vi.fn() };
  const scratch = { beforeEvaluate: vi.fn(), previewStopping: vi.fn() };
  const bridge = createSetBridge({
    previewEngine: () => engine,
    isPreviewing: () => previewing,
    setPreviewing: (value) => (previewing = value),
    isPlaying: () => true,
    editor: () => editor,
    runSwitch,
    scratch,
    canOpen: () => true,
    openTrack: vi.fn(),
    openStep: vi.fn(),
  });
  return { bridge, engine, scratch, isPreviewing: () => previewing };
}

describe('setBridge.manualGo', () => {
  it('stops the headphones and runs a forced manual switch; resolves when the mix completes', async () => {
    const result = deferred<{ outcome: 'switch'; result: 'ok' }>();
    const runSwitch = vi.fn(() => result.promise);
    const { bridge, engine, scratch, isPreviewing } = bridgeSetup(runSwitch as never);
    let settled: string | null = null;
    void bridge.manualGo(null).then((value) => (settled = value.result));
    expect(scratch.beforeEvaluate).toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalled();
    expect(isPreviewing()).toBe(false);
    expect(runSwitch).toHaveBeenCalledWith({ force: true, transition: null, manual: true });
    // The new code evaluating is not the end of a manual mix.
    bridge.evaluated('new');
    await flush();
    expect(settled).toBeNull();
    result.resolve({ outcome: 'switch', result: 'ok' });
    await flush();
    expect(settled).toBe('switched');
  });

  it('abandoned → abandoned; failed → failed', async () => {
    const abandoned = bridgeSetup(vi.fn(async () => ({ outcome: 'switch' as const, result: 'abandoned' as const })));
    expect(await abandoned.bridge.manualGo(null)).toEqual({ result: 'abandoned', code: 'new' });
    const failed = bridgeSetup(vi.fn(async () => ({ outcome: 'switch' as const, result: 'failed' as const })));
    expect((await failed.bridge.manualGo(null)).result).toBe('failed');
  });

  it('cancelled (Stop) → cancelled, and the headphones are not restarted', async () => {
    const { bridge, engine } = bridgeSetup(
      vi.fn(async () => ({ outcome: 'switch' as const, result: 'cancelled' as const })),
    );
    expect((await bridge.manualGo(null)).result).toBe('cancelled');
    expect(engine.evaluate).not.toHaveBeenCalled();
  });

  it('another switch in flight: ignored, and the cue goes back on the headphones', async () => {
    const { bridge, engine } = bridgeSetup(
      vi.fn(async () => ({ outcome: 'switch' as const, result: 'ignored' as const })),
    );
    expect((await bridge.manualGo(null)).result).toBe('ignored');
    expect(engine.evaluate).toHaveBeenCalledWith('new');
  });

  it('handOverManual asks the REPL; false without the dep', () => {
    const { bridge } = bridgeSetup(vi.fn());
    expect(bridge.handOverManual()).toBe(false);
  });
});

function evaluateSetup({ busy = false, playing = true, result = {} as object | Promise<never> } = {}) {
  const beginManual = vi.fn(async () => (result instanceof Promise ? result : result));
  const switchTo = vi.fn(async () => ({}));
  const repl = { scheduler: { started: playing }, evaluate: vi.fn(async () => ({})), stop: vi.fn() };
  const deps: EvaluateNewTrackDeps = {
    repl,
    globalSettings: () => ({ ...DEFAULT_TRANSITION, type: 'off' }),
    controllerBusy: () => busy,
    getController: () => ({ busy, switchTo, beginManual }),
    flash: vi.fn(),
    resetBeforeTransition: vi.fn(async () => {}),
    cleanupCanvases: vi.fn(async () => {}),
    setRestarting: vi.fn(),
  };
  return { deps, beginManual, switchTo, repl };
}

describe('evaluateNewTrack manual', () => {
  it('goes to beginManual even with the type Off (no instant path, no stop)', async () => {
    const { deps, beginManual, repl, switchTo } = evaluateSetup({ result: { manual: true } });
    expect(await evaluateNewTrack(deps, 'code', { restart: true, manual: true, keepOldOnFailure: true })).toBe('ok');
    expect(beginManual).toHaveBeenCalledWith('code', expect.objectContaining({ type: 'off' }), { prepare: undefined });
    expect(switchTo).not.toHaveBeenCalled();
    expect(repl.stop).not.toHaveBeenCalled();
    expect(repl.evaluate).not.toHaveBeenCalled();
  });

  it('maps abandoned, a busy controller and a failed evaluate', async () => {
    expect(await evaluateNewTrack(evaluateSetup({ result: { abandoned: true } }).deps, 'c', { manual: true })).toBe(
      'abandoned',
    );
    const busy = evaluateSetup({ busy: true });
    expect(await evaluateNewTrack(busy.deps, 'c', { manual: true })).toBe('ignored');
    expect(busy.beginManual).not.toHaveBeenCalled();
    const failing = evaluateSetup();
    failing.beginManual.mockRejectedValueOnce(Object.assign(new Error('x'), { evaluateFailed: true }) as never);
    expect(await evaluateNewTrack(failing.deps, 'c', { manual: true })).toBe('failed');
    expect(failing.repl.evaluate).not.toHaveBeenCalled();
  });

  it('Stop during the mix (the controller cancels it) is cancelled, not ignored', async () => {
    expect(await evaluateNewTrack(evaluateSetup({ result: { cancelled: true } }).deps, 'c', { manual: true })).toBe(
      'cancelled',
    );
    expect(await evaluateNewTrack(evaluateSetup({ result: { ignored: true } }).deps, 'c', { manual: true })).toBe(
      'ignored',
    );
  });
});

describe('runRestoringAbandon (review #3)', () => {
  function restoreSetup(result: SwitchResult) {
    let playingId: string | null = 'A';
    let activeCode = 'code A';
    const stamped: string[] = [];
    const deps = {
      playingTrackId: () => playingId,
      playingCode: () => activeCode,
      restorePlayingTrack: vi.fn((id: string | null) => (playingId = id)),
      restorePlayingCode: vi.fn((code: string) => {
        activeCode = code;
        stamped.push(code);
      }),
    };
    // The manual mix's begin evaluated B: afterEval stamped B as playing.
    const run = vi.fn(async () => {
      playingId = 'B';
      activeCode = 'code B';
      return result;
    });
    return { deps, run, stamped, playing: () => ({ id: playingId, code: activeCode }) };
  }

  it('an abandoned mix puts back the old track’s id and code (EQ recommendation, title, activeCode)', async () => {
    const { deps, run, playing, stamped } = restoreSetup('abandoned');
    expect(await runRestoringAbandon(run, deps)).toBe('abandoned');
    expect(playing()).toEqual({ id: 'A', code: 'code A' });
    expect(stamped).toEqual(['code A']);
  });

  it('negative: a completed mix keeps the new track', async () => {
    const { deps, run, playing } = restoreSetup('ok');
    expect(await runRestoringAbandon(run, deps)).toBe('ok');
    expect(playing()).toEqual({ id: 'B', code: 'code B' });
    expect(deps.restorePlayingCode).not.toHaveBeenCalled();
  });
});

describe('trackSwitch.restorePlaying', () => {
  it('after an abandoned mix the old track plays again: the editor’s new track is a switch, not a hot-swap', () => {
    const switcher = createTrackSwitchController();
    switcher.setEditorTrack('old');
    switcher.evaluated('old code');
    switcher.setEditorTrack('new');
    switcher.evaluationStarted('new code', 'new');
    switcher.evaluated('new code'); // the manual mix's begin evaluated the new code
    expect(switcher.decide(true)).toBe('hot-swap');
    switcher.restorePlaying('old');
    expect(switcher.playingTrackId).toBe('old');
    expect(switcher.decide(true)).toBe('switch');
  });
});
