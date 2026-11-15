// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.5 close-tab guard; tech §2.7)
 * beforeunload is cancelled (the browser asks "Leave site?") only while the main output plays;
 * other unload listeners (the emergency save) still run; uninstall removes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installCloseGuard } from '../closeGuard';

let uninstall: (() => void) | null = null;
const others: Array<() => void> = [];
afterEach(() => {
  uninstall?.();
  uninstall = null;
  others.splice(0).forEach((remove) => remove());
});

function unload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/** A fake window, to see exactly what the handler does to the event. */
function fakeWindow() {
  let handler: ((event: BeforeUnloadEvent) => void) | null = null;
  const win = {
    addEventListener: vi.fn((_: string, h: (event: BeforeUnloadEvent) => void) => (handler = h)),
    removeEventListener: vi.fn(() => (handler = null)),
  };
  const fire = () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    handler?.(event as unknown as BeforeUnloadEvent);
    return event;
  };
  return { win: win as unknown as Window, fire, raw: win };
}

describe('installCloseGuard', () => {
  it('playing: the event is cancelled, so the browser asks', () => {
    uninstall = installCloseGuard(() => true);
    expect(unload().defaultPrevented).toBe(true);
  });

  it('stopped (or only the preview playing): the event is not cancelled', () => {
    uninstall = installCloseGuard(() => false);
    expect(unload().defaultPrevented).toBe(false);
  });

  it('reads the scheduler at unload time, not at install time', () => {
    let playing = false;
    uninstall = installCloseGuard(() => playing);
    expect(unload().defaultPrevented).toBe(false);
    playing = true;
    expect(unload().defaultPrevented).toBe(true);
    playing = false;
    expect(unload().defaultPrevented).toBe(false);
  });

  it('sets the legacy returnValue while playing, and touches nothing while stopped', () => {
    let playing = true;
    const { win, fire } = fakeWindow();
    uninstall = installCloseGuard(() => playing, win);
    const asked = fire();
    expect(asked.preventDefault).toHaveBeenCalledTimes(1);
    expect(asked.returnValue).toBe('');
    playing = false;
    const quiet = fire();
    expect(quiet.preventDefault).not.toHaveBeenCalled();
    expect(quiet.returnValue).toBeUndefined();
  });

  it('the other unload listeners (emergency save) still run when it cancels', () => {
    const emergencySave = vi.fn();
    window.addEventListener('beforeunload', emergencySave);
    others.push(() => window.removeEventListener('beforeunload', emergencySave));
    uninstall = installCloseGuard(() => true);
    unload();
    expect(emergencySave).toHaveBeenCalledTimes(1);
  });

  it('installed before the emergency save, it still lets the save run (no stopImmediatePropagation)', () => {
    uninstall = installCloseGuard(() => true);
    const emergencySave = vi.fn();
    window.addEventListener('beforeunload', emergencySave);
    others.push(() => window.removeEventListener('beforeunload', emergencySave));
    expect(unload().defaultPrevented).toBe(true);
    expect(emergencySave).toHaveBeenCalledTimes(1);
  });

  it('a scheduler that throws on read does not block leaving', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    uninstall = installCloseGuard(() => {
      throw new Error('no repl');
    });
    expect(unload().defaultPrevented).toBe(false);
    vi.restoreAllMocks();
  });

  it('uninstall removes it', () => {
    uninstall = installCloseGuard(() => true);
    uninstall();
    uninstall = null;
    expect(unload().defaultPrevented).toBe(false);
  });
});
