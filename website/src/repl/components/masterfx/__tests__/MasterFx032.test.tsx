// @vitest-environment jsdom
/**
 * @spec: 032-master-fx (§2.2 knob, §2.6 holding, §2.8 on screen; tech §2.7, §4 UI)
 * Hold buttons: pointer down/up/cancel/lostpointercapture, Space/Enter held (auto-repeat ignored),
 * keyup and focus loss release, window blur releases, lit (aria-pressed) from a MIDI hold, a refused
 * Brake stays dark. The filter knob: double-click centres, aria-valuetext names the side, its row stays
 * left-to-right with LP on the left in Hebrew. The panel renders, persists to strudel-master-fx, All
 * FX off releases and centres, the brake note links to the scratch Brake slider. The performance row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import { createMasterFxRuntime, type MasterFxRuntime } from '../../../masterFx/masterFxRuntime';
import { MASTER_FX_STORAGE_KEY } from '../../../masterFx/masterFxSettings';
import { MidiMapContext, type MidiMapContextValue } from '../../../midi/midiMapContext';
import { createCrossfader } from '../../../midi/crossfader';
import { HoldButton } from '../HoldButton';
import { FilterKnob } from '../FilterKnob';
import { MasterFxPanel, SCRATCH_BRAKE_SLIDER_ID } from '../MasterFxPanel';
import { MasterFxRow } from '../MasterFxRow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let runtime: MasterFxRuntime;

function makeRuntime(brake = true) {
  const rt = createMasterFxRuntime({
    createFx: () => {
      throw new Error('no audio in this test');
    },
    storage: () => localStorage,
    getAudioContext: () => ({}) as AudioContext,
    getController: () => ({ setMasterInsert: () => {} }),
    windowTarget: window,
    documentTarget: document,
  });
  rt.setBrakeTarget({ brake: (down) => (down ? brake : false), watchBraking: () => () => {} });
  return rt;
}

function render(node: ReactNode, dir: 'ltr' | 'rtl' = 'ltr') {
  container = document.createElement('div');
  container.setAttribute('dir', dir);
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

const q = <T extends Element = HTMLElement>(selector: string) => container!.querySelector<T>(selector);

function pointer(el: Element, type: string, pointerId: number, pointerType = 'mouse', button = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => {
    el.dispatchEvent(event);
  });
}

function key(el: Element, type: 'keydown' | 'keyup', k: string, repeat = false) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, repeat }));
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces(['settings']);
  runtime = makeRuntime();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  runtime.destroy();
  localStorage.clear();
});

describe('HoldButton', () => {
  const button = () => q<HTMLButtonElement>('[data-master-fx-hold="delay"]')!;

  it('pointerdown holds, pointerup releases; aria-pressed follows', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    pointer(button(), 'pointerdown', 7);
    expect(runtime.held.get().delay).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('true');
    pointer(button(), 'pointerup', 7);
    expect(runtime.held.get().delay).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('pointercancel and lostpointercapture release too', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    pointer(button(), 'pointerdown', 1, 'touch');
    pointer(button(), 'pointercancel', 1, 'touch');
    expect(runtime.held.get().delay).toBe(false);
    pointer(button(), 'pointerdown', 2);
    pointer(button(), 'lostpointercapture', 2);
    expect(runtime.held.get().delay).toBe(false);
  });

  it('negative: a right click does not hold', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    pointer(button(), 'pointerdown', 1, 'mouse', 2);
    expect(runtime.held.get().delay).toBe(false);
  });

  it('Space and Enter held down hold (auto-repeat ignored), keyup releases', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    const hold = vi.spyOn(runtime, 'hold');
    key(button(), 'keydown', ' ');
    key(button(), 'keydown', ' ', true);
    expect(hold).toHaveBeenCalledTimes(1);
    expect(runtime.held.get().delay).toBe(true);
    key(button(), 'keyup', ' ');
    expect(runtime.held.get().delay).toBe(false);
    key(button(), 'keydown', 'Enter');
    expect(runtime.held.get().delay).toBe(true);
    key(button(), 'keyup', 'Enter');
    expect(runtime.held.get().delay).toBe(false);
    key(button(), 'keydown', 'a');
    expect(runtime.held.get().delay).toBe(false);
  });

  it('the window losing focus releases a mouse hold (no stuck effect)', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    pointer(button(), 'pointerdown', 3);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(runtime.held.get().delay).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('review 032 #3: after a blur release, the same pointer (no pointerup) holds again on its next press', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    pointer(button(), 'pointerdown', 1);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(runtime.held.get().delay).toBe(false);
    pointer(button(), 'pointerdown', 1);
    expect(runtime.held.get().delay).toBe(true);
    pointer(button(), 'pointerup', 1);
    expect(runtime.held.get().delay).toBe(false);
  });

  it('review 032 #3: after a hidden-tab release, a held key (no keyup) holds again on its next press', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    key(button(), 'keydown', 'Enter');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    delete (document as { visibilityState?: string }).visibilityState;
    expect(runtime.held.get().delay).toBe(false);
    key(button(), 'keydown', 'Enter');
    expect(runtime.held.get().delay).toBe(true);
  });

  it('the button losing focus while a key holds it releases', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    act(() => button().focus());
    key(button(), 'keydown', 'Enter');
    act(() => button().blur());
    expect(runtime.held.get().delay).toBe(false);
  });

  it('lit when MIDI holds the effect, whatever input', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    act(() => {
      runtime.hold('delay', 'midi:masterFx.delay');
    });
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().dataset.held).toBe('true');
  });

  it('a refused Brake (platter held) stays dark', () => {
    runtime.destroy();
    runtime = makeRuntime(false);
    render(<HoldButton effect="brake" label="Brake" runtime={runtime} />);
    const brake = q<HTMLButtonElement>('[data-master-fx-hold="brake"]')!;
    pointer(brake, 'pointerdown', 1);
    expect(brake.getAttribute('aria-pressed')).toBe('false');
  });

  it('is labelled for screen readers', () => {
    render(<HoldButton effect="delay" label="Delay" runtime={runtime} />);
    expect(button().getAttribute('aria-label')).toBe('Delay (hold)');
  });
});

describe('FilterKnob', () => {
  const slider = () => q<HTMLInputElement>('[data-master-fx-filter-slider]')!;

  it('moves the filter, names the side, and tells the MIDI map (pickup)', () => {
    const notify = vi.fn();
    const midi: MidiMapContextValue = {
      map: null,
      state: null,
      crossfader: createCrossfader(),
      notifyExternalChange: notify,
    };
    render(
      <MidiMapContext.Provider value={midi}>
        <FilterKnob runtime={runtime} />
      </MidiMapContext.Provider>,
    );
    expect(slider().getAttribute('aria-valuetext')).toBe('Off');
    setValue(slider(), '-40');
    expect(runtime.filter.get()).toBe(-40);
    expect(slider().getAttribute('aria-valuetext')).toBe('Low-pass 40%');
    expect(notify).toHaveBeenCalledWith('masterFx.filter');
    setValue(slider(), '70');
    expect(slider().getAttribute('aria-valuetext')).toBe('High-pass 70%');
    setValue(slider(), '2');
    expect(slider().getAttribute('aria-valuetext')).toBe('Off');
  });

  it('double-click centres it', () => {
    render(<FilterKnob runtime={runtime} />);
    setValue(slider(), '-60');
    act(() => {
      slider().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(runtime.filter.get()).toBe(0);
  });

  it('in Hebrew the panel mirrors, but the knob row stays left-to-right with LP on the left', async () => {
    await i18n.changeLanguage('he');
    render(<FilterKnob runtime={runtime} />, 'rtl');
    const row = q('[data-master-fx-filter-row]')!;
    expect(row.getAttribute('dir')).toBe('ltr');
    expect(slider().getAttribute('dir')).toBe('ltr');
    expect(row.firstElementChild!.getAttribute('data-filter-end')).toBe('lp');
    expect(row.lastElementChild!.getAttribute('data-filter-end')).toBe('hp');
    setValue(slider(), '-40');
    expect(slider().getAttribute('aria-valuetext')).toBe('מעביר נמוכים 40%');
  });
});

describe('MasterFxPanel', () => {
  it('renders every control and persists a change to strudel-master-fx', () => {
    render(<MasterFxPanel runtime={runtime} />);
    for (const effect of ['delay', 'reverb', 'repeat', 'brake']) {
      expect(q(`[data-master-fx-hold="${effect}"]`)).not.toBeNull();
    }
    setValue(q<HTMLInputElement>('#master-fx-resonance')!, '55');
    setValue(q<HTMLSelectElement>('#master-fx-delay-time')!, '2'); // 1/4
    setValue(q<HTMLInputElement>('#master-fx-reverb-decay')!, '5.5');
    setValue(q<HTMLSelectElement>('#master-fx-repeat-length')!, '3'); // 1/16
    const saved = JSON.parse(localStorage.getItem(MASTER_FX_STORAGE_KEY)!);
    expect(saved.resonance).toBeCloseTo(0.55, 9);
    expect(saved.delay.fraction).toBe(1 / 4);
    expect(saved.reverb.decay).toBe(5.5);
    expect(saved.repeatLength).toBe(1 / 16);
    expect(q('#master-fx-delay-time')!.textContent).toContain('3/16 cycle');
  });

  it('All FX off releases Delay and Beat-repeat and centres the filter', () => {
    render(<MasterFxPanel runtime={runtime} />);
    act(() => {
      runtime.hold('delay', 'midi:masterFx.delay');
      runtime.hold('repeat', 'pointer:1');
      runtime.setFilter(-40);
    });
    act(() => q<HTMLButtonElement>('[data-master-fx-all-off]')!.click());
    expect(runtime.held.get()).toEqual({ delay: false, reverb: false, repeat: false, brake: false });
    expect(runtime.filter.get()).toBe(0);
    expect(q('[data-master-fx-filter]')!.getAttribute('data-side')).toBe('off');
  });

  it('the brake note links to the scratch Brake slider and focuses it', () => {
    const scratch = document.createElement('input');
    scratch.id = SCRATCH_BRAKE_SLIDER_ID;
    document.body.appendChild(scratch);
    render(<MasterFxPanel runtime={runtime} />);
    expect(q('[data-master-fx-brake-note]')!.textContent).toContain('Uses the scratch Brake and Spin-up times.');
    act(() => q<HTMLAnchorElement>('[data-master-fx-brake-link]')!.click());
    expect(document.activeElement).toBe(scratch);
    scratch.remove();
  });
});

describe('MasterFxRow (performance strip)', () => {
  it('has the filter knob, the repeat length and the four hold buttons, and wraps', () => {
    render(<MasterFxRow runtime={runtime} />);
    const row = q('[data-perf-master-fx]')!;
    expect(row.className).toContain('flex-wrap');
    expect(row.querySelector('[data-master-fx-filter-slider]')).not.toBeNull();
    expect(row.querySelectorAll('[data-master-fx-hold]')).toHaveLength(4);
    setValue(row.querySelector<HTMLSelectElement>('[data-master-fx-select="perf-repeat-length"]')!, '0');
    expect(runtime.settings.get().repeatLength).toBe(1 / 2);
  });
});
