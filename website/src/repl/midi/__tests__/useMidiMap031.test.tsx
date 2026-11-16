// @vitest-environment jsdom
/**
 * @spec: 031-midi-mapping (§2.2 Esc, §2.3 soft takeover, §2.4 sliders, §2.5 crossfader on screen; tech §2.6)
 * useMidiMap creates the map once with the §2.1 targets; Esc cancels a running Learn (and only
 * then); an EQ band changed by anything but its own control drops that band's pickup; the volume and
 * crossfader sliders call the same setters MIDI uses and drop the pickup; the crossfader says
 * "Nothing cued" and does nothing without a next track, and starts the set's manual Go with one.
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

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MidiMapState } from '@strudel/mixer';
import i18n from '@src/i18n/i18n';
import { useMidiMap, MidiMapContext, type UseMidiMapOptions } from '../useMidiMap';
import { getEqSlots, resetEqStoreForTests, setEqBand } from '../../eqStore';
import { getSpeakersVolume, resetSpeakersVolumeForTests } from '../../speakersVolume';
import { resetHeadphonesVolumeForTests } from '../../headphonesVolume';
import { MixerLevels } from '../../components/panel/MixerLevels';
import { SetPlayerContext, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { NO_SET } from '../../sets/setPlayer';
import { midiEqBandSource } from '../midiTargets';
import { masterFxRuntime } from '../../masterFx/masterFxRuntime';
import { atom } from 'nanostores';
import { claimMidiLearn } from '@strudel/mixer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const STATE: MidiMapState = {
  status: 'ready',
  inputs: [],
  learning: null,
  bindings: {},
  awaitingPickup: [],
  lastLearn: null,
};

function fakeMapFactory() {
  let listener: ((state: MidiMapState) => void) | null = null;
  const map = {
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
    subscribe: vi.fn((fn: (state: MidiMapState) => void) => {
      listener = fn;
      return () => (listener = null);
    }),
    ready: Promise.resolve(),
    destroy: vi.fn(),
  };
  const createMap = vi.fn(() => map);
  return { map, createMap, emit: (state: Partial<MidiMapState>) => act(() => listener?.({ ...STATE, ...state })) };
}

function Harness({ options, children }: { options: UseMidiMapOptions; children?: ReactNode }) {
  const value = useMidiMap(options);
  return <MidiMapContext.Provider value={value}>{children}</MidiMapContext.Provider>;
}

function setPlayerValue(over: Partial<SetPlayerContextValue> = {}): SetPlayerContextValue {
  return {
    enabled: true,
    player: NO_SET,
    press: vi.fn(),
    manualGo: vi.fn(async () => 'switched' as const),
    ...over,
  } as unknown as SetPlayerContextValue;
}

function fakeScratch(learning: 'jog' | 'brake' | null = null) {
  return {
    store: atom({
      midi: { state: learning === 'jog' ? 'learning' : 'off', mapping: null },
      feelMidi: { state: 'off', learning: learning === 'brake' ? 'brake' : null, mappings: {}, message: null },
    }),
    cancelFeelLearn: vi.fn(),
  };
}

function render({
  scratch = fakeScratch(),
  handOver = false,
  setPlayer = null as SetPlayerContextValue | null,
  engine = null as null | { isInitialized: boolean; getVolume: () => number; setVolume: (v: number) => boolean },
  playing = true,
  ids = { editor: 't1', playing: 't1' },
} = {}) {
  const factory = fakeMapFactory();
  const manualMix = {
    isPlaying: vi.fn(() => playing),
    beginEditor: vi.fn(async () => 'complete' as const),
    setProgress: vi.fn(() => true),
    handOver: vi.fn(() => handOver),
  };
  const options: UseMidiMapOptions = {
    context: { handleTogglePlay: vi.fn(), handleEvaluate: vi.fn(), trackIds: () => ids, manualMix },
    mixer: engine,
    setPlayer,
    createMap: factory.createMap as unknown as UseMidiMapOptions['createMap'],
    scratch: scratch as unknown as UseMidiMapOptions['scratch'],
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SetPlayerContext.Provider value={setPlayer}>
        <Harness options={options}>
          <MixerLevels mixer={engine} />
        </Harness>
      </SetPlayerContext.Provider>,
    ),
  );
  return { ...factory, manualMix };
}

const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);
function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
  localStorage.clear();
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  resetHeadphonesVolumeForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  resetEqStoreForTests();
  resetSpeakersVolumeForTests();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useMidiMap', () => {
  it('creates the map once with the 21 targets (27 with spec 032 Master FX), and destroys it on unmount', () => {
    const { createMap, map } = render();
    expect(createMap).toHaveBeenCalledTimes(1);
    const targets = (createMap.mock.calls[0] as unknown as [{ targets: { id: string }[] }])[0].targets;
    expect(targets).toHaveLength(27);
    act(() => root!.unmount());
    root = null;
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });

  it('Esc cancels a running Learn; negative: Esc with no Learn does nothing', () => {
    const { map, emit } = render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(map.cancelLearn).not.toHaveBeenCalled();
    emit({ learning: 'eq.band.1' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(map.cancelLearn).toHaveBeenCalledTimes(1);
  });

  it('Esc cancels a jog Learn started from the panel (it holds the one-Learn lock)', () => {
    const jogCancel = vi.fn();
    const release = claimMidiLearn(jogCancel, localStorage); // what the jog's Learn does
    const scratch = fakeScratch('jog');
    render({ scratch });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(jogCancel).toHaveBeenCalledTimes(1);
    expect(scratch.cancelFeelLearn).toHaveBeenCalledTimes(1);
    release();
  });

  it('Esc cancels a feel Learn; negative: with no scratch Learn the lock holder is left alone', () => {
    const scratch = fakeScratch('brake');
    render({ scratch });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(scratch.cancelFeelLearn).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    container!.remove();
    const holder = vi.fn();
    const release = claimMidiLearn(holder, localStorage);
    const idle = fakeScratch();
    render({ scratch: idle });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(holder).not.toHaveBeenCalled();
    expect(idle.cancelFeelLearn).not.toHaveBeenCalled();
    release();
  });

  it('the Cue/Go target hands a manual mix over even without a set player (review #6)', () => {
    const { createMap, manualMix } = render({ setPlayer: null, handOver: true });
    const targets = (createMap.mock.calls[0] as unknown as [{ targets: { id: string; press?: () => void }[] }])[0]
      .targets;
    targets.find((target) => target.id === 'set.cueGo')!.press!();
    expect(manualMix.handOver).toHaveBeenCalledTimes(1);
  });

  it('negative: with no mix running, the Cue/Go target is the set player’s press', () => {
    const setPlayer = setPlayerValue();
    const { createMap } = render({ setPlayer });
    const targets = (createMap.mock.calls[0] as unknown as [{ targets: { id: string; press?: () => void }[] }])[0]
      .targets;
    targets.find((target) => target.id === 'set.cueGo')!.press!();
    expect(setPlayer.press).toHaveBeenCalledTimes(1);
  });

  it('a band changed on screen drops its pickup; the band’s own MIDI write doesn’t', () => {
    const { map } = render();
    getEqSlots();
    act(() => void setEqBand(2, { gain: 6 }, [], 'panel:1'));
    expect(map.notifyExternalChange).toHaveBeenCalledWith('eq.band.3');
    map.notifyExternalChange.mockClear();
    act(() => void setEqBand(2, { gain: 9 }, [], midiEqBandSource(2)));
    expect(map.notifyExternalChange).not.toHaveBeenCalled();
  });
});

describe('the Mixer settings levels', () => {
  it('spec 032 (review #2): All FX off drops the filter knob pickup; the knob own MIDI write does not', () => {
    const { map } = render();
    act(() => masterFxRuntime.setFilter(-40, 'midi:masterFx.filter'));
    expect(map.notifyExternalChange).not.toHaveBeenCalledWith('masterFx.filter');
    act(() => masterFxRuntime.allOff());
    expect(map.notifyExternalChange).toHaveBeenCalledWith('masterFx.filter');
  });

  it('the speakers slider sets the speakers volume and drops the pickup', () => {
    const { map } = render();
    drag(q<HTMLInputElement>('#mixer-level-speakers')!, '40');
    expect(getSpeakersVolume()).toBe(0.4);
    expect(map.notifyExternalChange).toHaveBeenCalledWith('mixer.speakers');
    expect(q('[data-mixer-level="speakers"] [data-mixer-level-value]')!.textContent).toBe('40%');
  });

  it('the headphones slider shows while the preview engine is active and sets its volume', () => {
    const engine = {
      isInitialized: true,
      volume: 1,
      getVolume: () => engine.volume,
      setVolume: vi.fn((v: number) => !!(engine.volume = v)),
    };
    const { map } = render({ engine });
    drag(q<HTMLInputElement>('#mixer-level-headphones')!, '70');
    expect(engine.setVolume).toHaveBeenCalledWith(0.7);
    expect(map.notifyExternalChange).toHaveBeenCalledWith('mixer.headphones');
  });

  it('negative: no headphones slider without an active preview engine', () => {
    render({ engine: { isInitialized: false, getVolume: () => 1, setVolume: () => true } });
    expect(q('#mixer-level-headphones')).toBeNull();
  });

  it('the crossfader with nothing next says Nothing cued and starts nothing', () => {
    const setPlayer = setPlayerValue();
    const { map, manualMix } = render({ setPlayer });
    expect(q('[data-crossfader-status]')!.textContent).toBe('Nothing cued');
    drag(q<HTMLInputElement>('[data-crossfader-slider]')!, '600');
    expect(map.notifyExternalChange).toHaveBeenCalledWith('mixer.crossfader');
    expect(setPlayer.manualGo).not.toHaveBeenCalled();
    expect(manualMix.beginEditor).not.toHaveBeenCalled();
    expect(manualMix.setProgress).not.toHaveBeenCalled();
  });

  it('with a set cue the crossfader starts the set’s manual Go and drives the progress; A plays first', () => {
    const setPlayer = setPlayerValue({ player: { ...NO_SET, setId: 's', cuedItemId: 'b', phase: 'cued' } });
    let finish: (value: 'switched') => void = () => {};
    (setPlayer.manualGo as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((r) => (finish = r)));
    const { manualMix } = render({ setPlayer });
    expect(q('[data-crossfader-end="left"]')!.getAttribute('data-playing')).toBe('true');
    expect(q('[data-crossfader-status]')!.textContent).toBe('Playing: Side A');
    drag(q<HTMLInputElement>('[data-crossfader-slider]')!, '300');
    expect(setPlayer.manualGo).toHaveBeenCalledTimes(1);
    expect(manualMix.setProgress).toHaveBeenLastCalledWith(0.3);
    expect(q('[data-crossfader-status]')!.textContent).toBe('Mixing: 30%');
    finish('switched');
  });

  it('without a set, the editor’s different track goes through the Update path as a manual mix', () => {
    const { manualMix } = render({ ids: { editor: 't2', playing: 't1' } });
    drag(q<HTMLInputElement>('[data-crossfader-slider]')!, '200');
    expect(manualMix.beginEditor).toHaveBeenCalledTimes(1);
  });
});
