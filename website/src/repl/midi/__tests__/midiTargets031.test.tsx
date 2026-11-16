// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (§2.1 targets, §2.4 volumes; tech §2.6 midiTargets.ts, §4 web)
 * Each target reaches its on-screen control's action. The EQ bands go through the EQ panel's own
 * state path (eqStore): the mounted panel's slider moves, the active A/B slot is saved, and a band
 * moved while the EQ is off is stored, not heard, until the EQ goes on. Next/Previous type wraps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AudioEqualizer, EQ_SLOTS_STORAGE_KEY } from '@strudel/equalizer';
import type { MidiMapTarget } from '@strudel/mixer';
import i18n from '@src/i18n/i18n';
import { MockAudioContext } from '../../../../../packages/mixer/test/webAudioMock.mjs';
import { destroyMainEqualizer, getMainEqualizer, initMainEqualizer } from '../../mainEqualizer';
import { resetEqStoreForTests } from '../../eqStore';
import { getSpeakersVolume, resetSpeakersVolumeForTests } from '../../speakersVolume';
import { resetHeadphonesVolumeForTests } from '../../headphonesVolume';
import { EqualizerUI } from '../../components/panel/EqualizerUI';
import {
  MIDI_TARGETS,
  MIDI_TARGET_IDS,
  bandGainToUnit,
  buildMidiTargets,
  stepTransitionType,
  unitToBandGain,
  type MidiTargetDeps,
} from '../midiTargets';
import { createCrossfader } from '../crossfader';
import type { TransitionType } from '../../transitionSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let preview: AudioEqualizer;

const applied = (eq: AudioEqualizer) =>
  (eq as unknown as { bands: { filter: { gain: { value: number } } }[] }).bands.map((b) => b.filter.gain.value);
const savedSlots = () => JSON.parse(localStorage.getItem(EQ_SLOTS_STORAGE_KEY) ?? 'null');
const bandSliders = () => container!.querySelectorAll<HTMLInputElement>('input[type="range"]');

function setup(over: Partial<MidiTargetDeps> = {}) {
  let type: TransitionType = 'off';
  const engine = {
    volume: 1,
    getVolume: vi.fn(() => engine.volume),
    setVolume: vi.fn((v: number) => !!(engine.volume = v)),
  };
  const crossfader = createCrossfader();
  const deps: MidiTargetDeps = {
    equalizers: () => [getMainEqualizer(), preview].filter((eq): eq is AudioEqualizer => !!eq),
    previewEngine: () => engine,
    crossfader,
    cueGo: vi.fn(),
    togglePlay: vi.fn(),
    update: vi.fn(),
    togglePerformance: vi.fn(),
    getTransitionType: () => type,
    setTransitionType: vi.fn((next: TransitionType) => {
      type = next;
    }),
    label: (meta) => `label:${meta.id}`,
    ...over,
  };
  const targets = buildMidiTargets(deps);
  const byId = (id: string) => targets.find((target) => target.id === id) as MidiMapTarget;
  return { deps, targets, byId, engine, crossfader, getType: () => type };
}

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<EqualizerUI previewEngine={{ equalizer: preview }} />));
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
  const ac = new MockAudioContext();
  initMainEqualizer(ac as unknown as AudioContext, { setOutputInsert: vi.fn() });
  preview = new AudioEqualizer(ac as unknown as AudioContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  destroyMainEqualizer();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('the target list', () => {
  it('has the §2.1 targets: 10 bands, EQ on/off, A/B, 3 mixer, Cue/Go, Play/Stop, Update, ±type, Perform', () => {
    // 21 from spec 031, plus spec 032's six Master FX rows.
    expect(MIDI_TARGETS).toHaveLength(27);
    expect(MIDI_TARGETS.filter((meta) => meta.group !== 'masterFx')).toHaveLength(21);
    expect(MIDI_TARGETS.filter((meta) => meta.group === 'eq' && meta.kind === 'continuous')).toHaveLength(10);
    const { targets } = setup();
    expect(targets.map((target) => target.id)).toEqual(MIDI_TARGETS.map((meta) => meta.id));
    expect(targets.every((target) => target.label === `label:${target.id}`)).toBe(true);
  });

  it('a band maps 0 → −24 dB, 127 → +24 dB and 64 → 0 dB, on the slider’s 0.5 dB grid', () => {
    expect(unitToBandGain(0)).toBe(-24);
    expect(unitToBandGain(1)).toBe(24);
    expect(unitToBandGain(64 / 127)).toBe(0);
    expect(bandGainToUnit(0)).toBe(0.5);
  });
});

describe('EQ targets take the panel’s state path', () => {
  it('a band write moves the mounted panel’s slider, saves the active slot and reaches both EQs', () => {
    renderPanel();
    const { byId } = setup();
    act(() => byId('eq.band.3').write!(1));
    expect(bandSliders()[2].value).toBe('24');
    expect(savedSlots().A.bands[2].gain).toBe(24);
    expect(savedSlots().A.preset).toBe('custom');
    expect(applied(getMainEqualizer()!)[2]).toBe(24);
    expect(applied(preview)[2]).toBe(24);
    expect(byId('eq.band.3').read!()).toBe(1);
  });

  it('with the panel closed, a band write is still saved where the panel reads it on open', () => {
    const { byId } = setup();
    byId('eq.band.5').write!(0);
    expect(savedSlots().A.bands[4].gain).toBe(-24);
    renderPanel();
    expect(bandSliders()[4].value).toBe('-24');
  });

  it('EQ off: a band write is stored and shown, not heard; switching on brings it in', () => {
    renderPanel();
    const { byId } = setup();
    const main = getMainEqualizer()!;
    act(() => byId(MIDI_TARGET_IDS.eqToggle).press!());
    expect(main.getState().isEnabled).toBe(false);
    expect(savedSlots().A.isEnabled).toBe(false);
    act(() => byId('eq.band.2').write!(1));
    expect(bandSliders()[1].value).toBe('24');
    expect(applied(main)).toEqual(Array(10).fill(0));
    expect(main.getState().bands[1].gain).toBe(24);
    act(() => byId(MIDI_TARGET_IDS.eqToggle).press!());
    expect(applied(main)[1]).toBe(24);
  });

  it('A/B switches the active slot as the panel’s buttons do', () => {
    renderPanel();
    const { byId } = setup();
    act(() => byId(MIDI_TARGET_IDS.eqAb).press!());
    expect(savedSlots().active).toBe('B');
    expect(container!.querySelector('[data-eq-slot="B"]')!.getAttribute('aria-pressed')).toBe('true');
    act(() => byId(MIDI_TARGET_IDS.eqAb).press!());
    expect(savedSlots().active).toBe('A');
  });
});

describe('mixer, set, transport, transition and view targets', () => {
  it('speakers volume reads and writes the speakers level; headphones the preview engine', () => {
    const { byId, engine } = setup();
    byId(MIDI_TARGET_IDS.speakers).write!(0.5);
    expect(getSpeakersVolume()).toBe(0.5);
    expect(byId(MIDI_TARGET_IDS.speakers).read!()).toBe(0.5);
    byId(MIDI_TARGET_IDS.headphones).write!(0.25);
    expect(engine.setVolume).toHaveBeenCalledWith(0.25);
    expect(byId(MIDI_TARGET_IDS.headphones).read!()).toBe(0.25);
  });

  it('without a preview engine the headphones read unity and ignore writes', () => {
    const { byId } = setup({ previewEngine: () => null });
    expect(byId(MIDI_TARGET_IDS.headphones).read!()).toBe(1);
    expect(() => byId(MIDI_TARGET_IDS.headphones).write!(0.2)).not.toThrow();
  });

  it('the crossfader target is the crossfader’s position', () => {
    const { byId, crossfader } = setup();
    byId(MIDI_TARGET_IDS.crossfader).write!(0.01);
    expect(crossfader.getState().position).toBe(0.01);
    expect(byId(MIDI_TARGET_IDS.crossfader).read!()).toBe(0.01);
  });

  it('Cue/Go, Play/Stop, Update and Performance call their on-screen actions once', () => {
    const { byId, deps } = setup();
    byId(MIDI_TARGET_IDS.cueGo).press!();
    byId(MIDI_TARGET_IDS.playStop).press!();
    byId(MIDI_TARGET_IDS.update).press!();
    byId(MIDI_TARGET_IDS.performance).press!();
    expect(deps.cueGo).toHaveBeenCalledTimes(1);
    expect(deps.togglePlay).toHaveBeenCalledTimes(1);
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(deps.togglePerformance).toHaveBeenCalledTimes(1);
  });

  it('Next type on the last type wraps to the first; Previous on the first wraps to the last', () => {
    expect(stepTransitionType('layeredIntro', 1)).toBe('off');
    expect(stepTransitionType('off', -1)).toBe('layeredIntro');
    expect(stepTransitionType('dip', 1)).toBe('cut');
    const { byId, getType } = setup();
    byId(MIDI_TARGET_IDS.prevType).press!();
    expect(getType()).toBe('layeredIntro');
    byId(MIDI_TARGET_IDS.nextType).press!();
    expect(getType()).toBe('off');
  });
});
