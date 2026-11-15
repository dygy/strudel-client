// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.5 close-tab guard; review #1)
 * With the close-tab guard, "Stay" is a common answer while music plays. A cancelled beforeunload
 * (the user stays) must leave the canvases and the draw loop alone; pagehide (the page really goes)
 * cleans them up. And the REPL wires its canvas cleanup this way, not on beforeunload.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCanvasUnloadCleanup } from '../canvasUnloadCleanup';
import { installCloseGuard } from '../performance/closeGuard';

const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  document.body.innerHTML = '';
});

/** Stands in for the REPL's visuals: a draw loop and a pianoroll canvas with something drawn. */
function visuals() {
  const state = { loopRunning: true, cleared: false };
  const canvas = document.createElement('canvas');
  canvas.id = 'test-canvas';
  document.body.appendChild(canvas);
  const cleanup = async () => {
    state.loopRunning = false;
    state.cleared = true;
  };
  return { state, canvas, cleanup };
}

function beforeUnload() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('installCanvasUnloadCleanup', () => {
  it('a cancelled beforeunload ("Stay" while music plays) leaves the canvases and draw loop alone', async () => {
    const { state, canvas, cleanup } = visuals();
    stops.push(installCanvasUnloadCleanup(cleanup));
    stops.push(installCloseGuard(() => true));
    const event = beforeUnload();
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(state).toEqual({ loopRunning: true, cleared: false });
    expect(document.body.contains(canvas)).toBe(true);
  });

  it('pagehide (the page really goes) cleans them up', async () => {
    const { state, cleanup } = visuals();
    stops.push(installCanvasUnloadCleanup(cleanup));
    window.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(state).toEqual({ loopRunning: false, cleared: true });
  });

  it('a cleanup that fails does not throw out of pagehide', async () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      stops.push(
        installCanvasUnloadCleanup(() => {
          throw new Error('boom');
        }),
      );
      expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
      stops.push(installCanvasUnloadCleanup(() => Promise.reject(new Error('later'))));
      window.dispatchEvent(new Event('pagehide'));
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      console.warn = original;
    }
  });

  it('uninstall removes it', () => {
    const { state, cleanup } = visuals();
    const stop = installCanvasUnloadCleanup(cleanup);
    stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(state.cleared).toBe(false);
  });

  it('the REPL runs its canvas cleanup on pagehide, and registers no beforeunload of its own', () => {
    const source = readFileSync(resolve(process.cwd(), 'website/src/repl/useReplContext.tsx'), 'utf8');
    expect(source).toMatch(/installCanvasUnloadCleanup\(/);
    expect(source).not.toMatch(/addEventListener\(\s*['"]beforeunload['"]/);
  });
});
