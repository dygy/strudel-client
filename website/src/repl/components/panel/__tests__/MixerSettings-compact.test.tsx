// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (§2.3, tech §2.5)
 * Mixer and output-device controls on a phone: 44px touch targets, sliders that do not scroll the
 * sheet and show their value; on a laptop the classes are exactly the desktop ones.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

// repl/util lazy-imports every @strudel package; not under test.
vi.mock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false }));
vi.mock('@strudel/webaudio', () => ({ getAudioDevices: async () => new Map([['Speakers', 'speakers-id']]) }));
vi.mock('../EqualizerUI', () => ({ EqualizerUI: () => <div>eq</div> }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MixerSettings } from '../MixerSettings';
import { AudioDeviceSelector } from '../AudioDeviceSelector';
import { AudioEngineTargetSelector } from '../AudioEngineTargetSelector';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DESKTOP_RANGE = 'w-full h-2 bg-lineHighlight rounded-lg appearance-none cursor-pointer accent-foreground';
const DESKTOP_DEVICE_SELECT =
  'w-full px-4 py-3 bg-background border border-lineHighlight rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-foreground focus:border-transparent transition-all duration-200 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const transitions = () => ({
  getSettings: () => ({ enabled: true, duration: 2 }),
  updateSettings: vi.fn(),
});
const mixer = { isInitialized: true, setDevice: vi.fn(async () => {}) };

function drag(input: HTMLInputElement, to: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, to);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
});

describe('mixer controls on a phone (390x844)', () => {
  it('the transition slider is a 44px, no-scroll touch target that shows its value while dragged', () => {
    setViewport(390, 844);
    const manager = transitions();
    const c = render(<MixerSettings mixer={mixer} smoothTransitionManager={manager} />);
    const range = c.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(range.className).toMatch(/\bh-11\b/);
    expect(range.className).toMatch(/\btouch-none\b/);

    drag(range, '4.5');
    expect(manager.updateSettings).toHaveBeenCalledWith({ duration: 4.5 });
    expect(c.textContent).toContain('4.5s');
  });

  it('the toggle and the preview device select are 44px tall', () => {
    setViewport(390, 844);
    const c = render(<MixerSettings mixer={mixer} smoothTransitionManager={transitions()} />);
    expect(c.querySelector('input[type="checkbox"]')!.closest('label')!.className).toMatch(/\bmin-h-11\b/);
    expect(c.querySelector('select')!.className).toMatch(/\bmin-h-11\b/);
  });

  it('the output device and engine selects get a 44px touch target', () => {
    setViewport(390, 844);
    const c = render(
      <>
        <AudioDeviceSelector audioDeviceName="" onChange={() => {}} isDisabled={false} />
        <AudioEngineTargetSelector target="webaudio" onChange={() => {}} />
      </>,
    );
    const selects = [...c.querySelectorAll('select')];
    expect(selects).toHaveLength(2);
    for (const select of selects) expect(select.parentElement!.className).toMatch(/\[&_select\]:min-h-11/);
  });
});

describe('mixer controls on a laptop (1440x900)', () => {
  it('keep exactly the desktop classes', () => {
    setViewport(1440, 900);
    const c = render(
      <>
        <MixerSettings mixer={mixer} smoothTransitionManager={transitions()} />
        <AudioDeviceSelector audioDeviceName="" onChange={() => {}} isDisabled={false} />
        <AudioEngineTargetSelector target="webaudio" onChange={() => {}} />
      </>,
    );
    expect(c.querySelector<HTMLInputElement>('input[type="range"]')!.className).toBe(DESKTOP_RANGE);
    const [deviceSelect, ...shared] = [...c.querySelectorAll('select')];
    expect(deviceSelect.className).toBe(DESKTOP_DEVICE_SELECT);
    expect(c.innerHTML).not.toMatch(/min-h-11|touch-none/);
    expect(shared).toHaveLength(2);
  });
});
