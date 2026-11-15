/**
 * @spec: 030-performance-mode (2.1 browser full screen; tech §2.1)
 * Opening asks for full screen; a refusal or a missing API leaves the view open; closing exits only
 * the full screen the view entered; leaving full screen after entering closes the view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atom } from 'nanostores';
import { installPerformanceFullscreen } from '../performanceFullscreen';

class FakeDoc extends EventTarget {
  fullscreenElement: Element | null = null;
  documentElement: { requestFullscreen?: () => Promise<void> };
  exitFullscreen = vi.fn(async () => {
    this.fullscreenElement = null;
    this.dispatchEvent(new Event('fullscreenchange'));
  });
  constructor(request?: () => Promise<void>) {
    super();
    this.documentElement = { requestFullscreen: request };
  }
  /** The browser grants the request (or the user presses F11). */
  enter() {
    this.fullscreenElement = {} as Element;
    this.dispatchEvent(new Event('fullscreenchange'));
  }
  /** The user leaves full screen (Esc). */
  leave() {
    this.fullscreenElement = null;
    this.dispatchEvent(new Event('fullscreenchange'));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function setup(request?: () => Promise<void>) {
  const open = atom(false);
  const doc = new FakeDoc(request);
  const close = vi.fn(() => open.set(false));
  uninstall = installPerformanceFullscreen({ open, close, doc: doc as unknown as Document });
  return { open, doc, close };
}

describe('installPerformanceFullscreen', () => {
  it('asks for full screen when the view opens, and leaves it when the view closes', async () => {
    const request = vi.fn(async () => {});
    const { open, doc } = setup(request);
    request.mockImplementation(async () => doc.enter());
    open.set(true);
    expect(request).toHaveBeenCalledTimes(1);
    await flush();
    open.set(false);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('a refused request leaves the view open and reports nothing', async () => {
    const request = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    const { open, doc, close } = setup(request);
    open.set(true);
    await flush();
    expect(open.get()).toBe(true);
    expect(close).not.toHaveBeenCalled();
    open.set(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('a missing API (iOS Safari, an iframe) leaves the view open', () => {
    const { open, close } = setup(undefined);
    expect(() => open.set(true)).not.toThrow();
    expect(open.get()).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  it('a request that throws synchronously is swallowed', () => {
    const { open } = setup(() => {
      throw new TypeError('not allowed');
    });
    expect(() => open.set(true)).not.toThrow();
    expect(open.get()).toBe(true);
  });

  it('leaving full screen (Esc) after the view entered it closes the view', async () => {
    const request = vi.fn(async () => {});
    const { open, doc, close } = setup(request);
    request.mockImplementation(async () => doc.enter());
    open.set(true);
    await flush();
    doc.leave();
    expect(close).toHaveBeenCalledTimes(1);
    expect(open.get()).toBe(false);
    // Already out: closing must not try to exit again.
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('never exits a full screen the view did not enter (the page was already full screen)', () => {
    const request = vi.fn(async () => {});
    const { open, doc } = setup(request);
    doc.enter();
    open.set(true);
    expect(request).not.toHaveBeenCalled();
    open.set(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).not.toBeNull();
  });

  // Review #5: enter then exit before the browser answers.
  it('a fast enter then exit leaves full screen once the pending request lands', async () => {
    let grant!: () => void;
    const request = vi.fn(() => new Promise<void>((resolve) => (grant = resolve)));
    const { open, doc } = setup(request);
    open.set(true);
    open.set(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    doc.enter();
    grant();
    await flush();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBeNull();
    expect(open.get()).toBe(false);
  });

  it('enter, exit, enter again before the request lands: stays in full screen with the view open', async () => {
    let grant!: () => void;
    const request = vi.fn(() => new Promise<void>((resolve) => (grant = resolve)));
    const { open, doc } = setup(request);
    open.set(true);
    open.set(false);
    open.set(true);
    expect(request).toHaveBeenCalledTimes(1);
    doc.enter();
    grant();
    await flush();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(open.get()).toBe(true);
    // And a later exit still leaves it.
    open.set(false);
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('a pending request that is refused after a fast exit does nothing more', async () => {
    let refuse!: (error: Error) => void;
    const request = vi.fn(() => new Promise<void>((_resolve, reject) => (refuse = reject)));
    const { open, doc } = setup(request);
    open.set(true);
    open.set(false);
    refuse(new Error('NotAllowedError'));
    await flush();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('uninstall stops following the view', () => {
    const request = vi.fn(async () => {});
    const { open } = setup(request);
    uninstall?.();
    uninstall = null;
    open.set(true);
    expect(request).not.toHaveBeenCalled();
  });
});
