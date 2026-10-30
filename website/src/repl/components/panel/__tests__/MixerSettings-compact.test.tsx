// @vitest-environment jsdom
/**
 * @spec: 016-responsive-repl-layout (§2.3, tech §2.5)
 * Mixer and output-device controls on a phone: 44px touch targets; on a laptop the classes are
 * exactly the desktop ones. Since spec 017 the transition controls are radio groups and checkboxes
 * (the seconds slider and the on/off toggle are gone).
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

const mixer = { isInitialized: true, setDevice: vi.fn(async () => {}) };

const radioLabels = (c: HTMLElement) => [...c.querySelectorAll('input[type="radio"]')].map((r) => r.closest('label')!);
const previewDeviceSelect = (c: HTMLElement) =>
  [...c.querySelectorAll('select')].find((sel) => sel.querySelector('option[value=""]'))!;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  setViewport(originalSize.width, originalSize.height);
});

describe('mixer controls on a phone (390x844)', () => {
  it('every transition option and the preview device select are 44px tall', () => {
    setViewport(390, 844);
    const c = render(<MixerSettings mixer={mixer} />);
    const labels = radioLabels(c);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    for (const label of labels) expect(label.className).toMatch(/\bmin-h-11\b/);
    expect(previewDeviceSelect(c).className).toMatch(/\bmin-h-11\b/);
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
        <MixerSettings mixer={mixer} />
        <AudioDeviceSelector audioDeviceName="" onChange={() => {}} isDisabled={false} />
        <AudioEngineTargetSelector target="webaudio" onChange={() => {}} />
      </>,
    );
    for (const label of radioLabels(c)) expect(label.className).not.toMatch(/\bmin-h-11\b/);
    expect(previewDeviceSelect(c).className).toBe(DESKTOP_DEVICE_SELECT);
    expect(c.innerHTML).not.toMatch(/min-h-11|touch-none/);
    expect(c.querySelectorAll('select')).toHaveLength(3);
  });
});
