// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (functional §2.5 manual crossfader; task 5.1)
 * The crossfader from useMidiMap end to end, with nothing faked between it and the music but the
 * repl and scheduler: the REAL set player controller, set bridge, evaluateNewTrack and
 * TrackTransitionController (packages/mixer/test/transitionHarness031.mjs fakes the repl only).
 *
 * - With a cued set item: the fader at 30 % mixes the cued track in (the set shows Go in progress);
 *   back to the playing end the old track plays alone and the item is still cued; the far end
 *   completes it (Now = the item, the playing end flips).
 * - Cut as the selected type mixes as a Crossfade.
 * - Go (the set's Cue/Go) mid-mix hands it to the timed transition, which completes the set.
 * - No set: the editor's different track is mixed in; the editor's own (playing) track: inert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});
// settings.ts imports repl/util, which pulls the whole tidal package.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MidiMapState } from '@strudel/mixer';
import i18n from '@src/i18n/i18n';
import { OLD, setupController, untilCycle } from '../../../../../packages/mixer/test/transitionHarness031.mjs';
import { useMidiMap, MidiMapContext, type UseMidiMapOptions } from '../useMidiMap';
import { useMidiMapContext } from '../midiMapContext';
import type { Crossfader } from '../crossfader';
import { resetEqStoreForTests } from '../../eqStore';
import { resetSpeakersVolumeForTests } from '../../speakersVolume';
import { resetHeadphonesVolumeForTests } from '../../headphonesVolume';
import { createSetBridge } from '../../sets/setBridge';
import { createSetPlayerController } from '../../sets/setPlayerController';
import type { PlayerSet } from '../../sets/setPlayer';
import type { SetPlayerContextValue } from '../../sets/useSetPlayer';
import { evaluateNewTrack, type EvaluateNewTrackDeps } from '../../evaluateNewTrack';
import { DEFAULT_TRANSITION, type TransitionSettings } from '../../transitionSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STATE: MidiMapState = {
  status: 'idle',
  inputs: [],
  learning: null,
  bindings: {},
  awaitingPickup: [],
  lastLearn: null,
};
/** The map itself is not under test here (midiPanelLive031 drives the real one). */
const fakeMap = () => ({
  learn: vi.fn(),
  cancelLearn: vi.fn(),
  clear: vi.fn(),
  clearAll: vi.fn(),
  bindings: vi.fn(() => ({})),
  exportJson: vi.fn(() => '{}'),
  importJson: vi.fn(() => ({ ok: true })),
  status: vi.fn(),
  getState: vi.fn(() => STATE),
  setTargets: vi.fn(),
  notifyExternalChange: vi.fn(),
  isPickedUp: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  ready: Promise.resolve(),
  destroy: vi.fn(),
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let crossfader: Crossfader | null = null;

function Capture() {
  crossfader = useMidiMapContext()!.crossfader;
  return null;
}
function Harness({ options }: { options: UseMidiMapOptions }) {
  const value = useMidiMap(options);
  return (
    <MidiMapContext.Provider value={value}>
      <Capture />
    </MidiMapContext.Provider>
  );
}

/** The REPL as useReplContext wires it, around the real controller on a fake repl. */
function setup({ type = 'crossfade' as TransitionSettings['type'], cued = true, editor = 't1' } = {}) {
  const settings: TransitionSettings = { ...DEFAULT_TRANSITION, type, length: 2, snap: 0 };
  const t = setupController({ settings });
  const evalDeps: EvaluateNewTrackDeps = {
    repl: t.repl as never,
    globalSettings: () => settings,
    controllerBusy: () => t.controller.busy,
    getController: () => t.controller as never,
    flash: vi.fn(),
    resetBeforeTransition: vi.fn(async () => {}),
    cleanupCanvases: vi.fn(async () => {}),
    setRestarting: vi.fn(),
  };
  const preview = { isInitialized: true, evaluate: vi.fn(async () => undefined), stop: vi.fn() };
  let previewing = false;
  const editorView = { code: 'A', evaluate: vi.fn() };
  const bridge = createSetBridge({
    previewEngine: () => preview,
    isPreviewing: () => previewing,
    setPreviewing: (value) => (previewing = value),
    isPlaying: () => t.sch.started,
    editor: () => editorView,
    runSwitch: async ({ transition, manual }) => ({
      outcome: 'switch',
      result: await evaluateNewTrack(evalDeps, editorView.code, {
        restart: true,
        transition,
        keepOldOnFailure: true,
        manual,
      }),
    }),
    scratch: { beforeEvaluate: vi.fn(), previewStopping: vi.fn() },
    canOpen: () => true,
    openTrack: vi.fn(async () => {}),
    openStep: vi.fn(async () => {}),
    handOverManual: () => t.controller.handManualToTimed(),
  });
  const set: PlayerSet = {
    id: 's1',
    items: [
      { id: 'a', trackId: 't1', transition: null },
      { id: 'b', trackId: 't2', transition: null },
    ],
  };
  const player = createSetPlayerController({
    bridge,
    getSet: (id) => (id === set.id ? set : null),
    getTracks: () => ({ t1: { id: 't1', name: 'One' }, t2: { id: 't2', name: 'Two' } }) as never,
  });
  const setPlayer = cued
    ? ({
        enabled: true,
        get player() {
          return player.getState();
        },
        press: () => void player.press(),
        manualGo: () => player.manualGo(),
      } as unknown as SetPlayerContextValue)
    : null;
  const beginEditor = vi.fn(async () => {
    const result = await evaluateNewTrack(evalDeps, editorView.code, { restart: true, manual: true });
    // Review #5 added 'cancelled' (Stop); for the crossfader it is a mix that is over, nothing flips.
    return result === 'ok' ? ('complete' as const) : result === 'cancelled' ? ('ignored' as const) : result;
  });
  const options: UseMidiMapOptions = {
    context: {
      handleTogglePlay: vi.fn(),
      handleEvaluate: vi.fn(),
      trackIds: () => ({ editor, playing: 't1' }),
      manualMix: {
        isPlaying: () => t.sch.started,
        beginEditor,
        setProgress: (p) => t.controller.setManualProgress(p),
        handOver: () => t.controller.handManualToTimed(),
      },
    },
    mixer: null,
    setPlayer,
    createMap: fakeMap as unknown as UseMidiMapOptions['createMap'],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness options={options} />));
  return { ...t, player, preview, beginEditor, cf: crossfader! };
}

async function cue(player: ReturnType<typeof setup>['player']) {
  player.start('s1', 'b');
  await player.press();
  expect(player.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'b' });
}
const tick = (ms = 120) => vi.advanceTimersByTimeAsync(ms);
const names = (pattern: { queryArc: (a: number, b: number) => { value: { s: string } }[] }, from: number) =>
  [...new Set(pattern.queryArc(from, from + 1).map((hap) => hap.value.s))].sort();

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
  localStorage.clear();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
  vi.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  crossfader = null;
  vi.useRealTimers();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('§2.5 with a cued set item', () => {
  it('30 % mixes the cued track in at p = 0.3 (the set shows the Go); back at the playing end it is abandoned and still cued', async () => {
    const t = setup();
    await cue(t.player);
    t.cf.setPosition(0.3);
    await tick();
    expect(t.player.getState().phase).toBe('going');
    expect(t.controller.getState()).toMatchObject({ manual: { p: 0.3 } });
    expect(t.sch.pattern).not.toBe(OLD);
    await untilCycle(t.sch, 11);
    expect(names(t.sch.pattern, 11)).toEqual(['new', 'old']); // both heard mid-mix
    expect(t.cf.getState()).toMatchObject({ mixing: true, playingEnd: 'left' });

    t.cf.setPosition(0);
    await tick();
    expect(t.sch.pattern).toBe(OLD); // the old track alone, as it was
    expect(t.player.getState()).toMatchObject({ phase: 'cued', cuedItemId: 'b', nowItemId: null });
    expect(t.preview.evaluate).toHaveBeenCalledTimes(2); // the cue is back on the headphones
    expect(t.cf.getState()).toMatchObject({ mixing: false, playingEnd: 'left', armed: true });
  });

  it('the far end completes it: Now = the item, the old track stops, and the playing end is the right', async () => {
    const t = setup();
    await cue(t.player);
    t.cf.setPosition(0.3);
    await tick();
    await untilCycle(t.sch, 11);
    t.cf.setPosition(1);
    await tick();
    expect(t.player.getState()).toMatchObject({ phase: 'idle', nowItemId: 'b', cuedItemId: null });
    expect(names(t.sch.pattern, 12)).toEqual(['new']);
    expect(t.cf.getState()).toMatchObject({ mixing: false, playingEnd: 'right', armed: true });
  });

  it('Cut as the selected type: the manual mix is a Crossfade (both tracks heard at 50 %)', async () => {
    const t = setup({ type: 'cut' });
    await cue(t.player);
    t.cf.setPosition(0.5);
    await tick();
    expect(t.controller.getState().type).toBe('crossfade');
    await untilCycle(t.sch, 11);
    expect(names(t.sch.pattern, 11)).toEqual(['new', 'old']);
    expect(t.destinationGain.gain.calls).toEqual([]);
  });

  it('Go mid-mix (Cue/Go) hands over to the timed transition from 0.5, which completes the set', async () => {
    const t = setup({ type: 'crossfade' });
    await cue(t.player);
    t.cf.setPosition(0.5);
    await tick();
    await untilCycle(t.sch, 10.5);
    const now = t.sch.now();
    await t.player.press();
    const state = t.controller.getState();
    expect(state.manual).toBeNull();
    expect(state.end).toBeCloseTo(now + 0.5 * 2, 1); // the clock takes the remaining half
    expect(t.player.getState().phase).toBe('going'); // no second Go, no Cue
    t.cf.setPosition(0.9); // the fader no longer drives it
    expect(t.controller.getState().end).toBe(state.end);
    await untilCycle(t.sch, state.end + 0.2);
    await tick();
    expect(t.player.getState()).toMatchObject({ phase: 'idle', nowItemId: 'b' });
    expect(t.cf.getState()).toMatchObject({ mixing: false, playingEnd: 'right' });
  });

  it('negative: a set Go with no manual mix in flight does not hand anything over (a timed Go runs)', async () => {
    const t = setup();
    await cue(t.player);
    void t.player.press(); // Go: a timed switch
    await tick();
    expect(t.controller.getState().manual ?? null).toBeNull();
    expect(t.controller.getState().end).not.toBeNull(); // on the clock
    expect(t.player.getState().phase).toBe('going');
    expect(t.controller.handManualToTimed()).toBe(false);
  });
});

describe('§2.5 without a set', () => {
  it('the editor shows a different track: left end → right end switches to it, as Update would', async () => {
    const t = setup({ cued: false, editor: 't2' });
    t.cf.setPosition(0.4);
    await tick();
    expect(t.beginEditor).toHaveBeenCalledTimes(1);
    await untilCycle(t.sch, 11);
    t.cf.setPosition(1);
    await tick();
    expect(names(t.sch.pattern, 12)).toEqual(['new']);
    expect(t.cf.getState()).toMatchObject({ mixing: false, playingEnd: 'right' });
  });

  it('negative: the editor shows the playing track: moving the fader changes nothing', async () => {
    const t = setup({ cued: false, editor: 't1' });
    t.cf.setPosition(0.4);
    t.cf.setPosition(1);
    await tick();
    expect(t.beginEditor).not.toHaveBeenCalled();
    expect(t.repl.evaluate).not.toHaveBeenCalled();
    expect(t.sch.pattern).toBe(OLD);
    expect(t.cf.getState()).toMatchObject({ mixing: false, inert: true, playingEnd: 'left' });
  });
});
