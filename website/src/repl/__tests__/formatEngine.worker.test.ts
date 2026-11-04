/**
 * A crashed worker left its requests waiting for the 30 s timeout, so a save waited too. A failing worker now gives way
 * to the main thread at once, for that request and the later ones. Autosave sends the text either way.
 *
 * @vitest-environment jsdom
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormatEngine as Engine, PrettierOptions } from '../formatEngine';

const options: PrettierOptions = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  printWidth: 120,
};

const LARGE = `setcps(1)\nlet a=1\n${'// filler\n'.repeat(600)}`;
const FORMATTED = LARGE.replace('let a=1', 'let a = 1');

class FakeWorker {
  static last: FakeWorker;
  posted: Array<{ id: string; type: string; data: { code: string } }> = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: { id: string; type: string; data: { code: string } }) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

let engine: Engine;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeWorker);
  const { FormatEngine } = await import('../formatEngine');
  engine = FormatEngine.getInstance();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => vi.resetModules());

describe('a worker that fails', () => {
  it('a crash: the waiting request is answered by the main thread, without the timeout', async () => {
    const pending = engine.formatCode(LARGE, options);
    expect(FakeWorker.last.posted).toHaveLength(1);
    FakeWorker.last.onerror!(new Event('error'));
    await expect(pending).resolves.toEqual({ success: true, formattedCode: FORMATTED });
  });

  it('a crash: every waiting request is answered, and the later ones skip the worker', async () => {
    const worker = FakeWorker.last;
    const first = engine.formatCode(LARGE, options);
    const second = engine.formatSelection(LARGE, 0, 20, options);
    worker.onerror!(new Event('error'));
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: true });
    expect(worker.terminated).toBe(true);
    await expect(engine.formatCode(LARGE, options)).resolves.toMatchObject({ formattedCode: FORMATTED });
    expect(worker.posted).toHaveLength(2);
  });

  it('a request it reports as failed goes to the main thread too', async () => {
    const pending = engine.formatCode(LARGE, options);
    const { id } = FakeWorker.last.posted[0];
    FakeWorker.last.onmessage!({ data: { id, success: false, error: 'boom' } });
    await expect(pending).resolves.toEqual({ success: true, formattedCode: FORMATTED });
  });

  it('a hang: after the timeout the main thread answers, and the worker is not asked again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const worker = FakeWorker.last;
    const pending = engine.formatCode(LARGE, options);
    await vi.advanceTimersByTimeAsync(30000);
    await expect(pending).resolves.toEqual({ success: true, formattedCode: FORMATTED });
    expect(worker.terminated).toBe(true);
    await engine.formatCode(LARGE, options);
    expect(worker.posted).toHaveLength(1);
  });
});

describe('a worker that answers', () => {
  it('its answer is used, and the timeout timer is cleared', async () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const pending = engine.formatCode(LARGE, options);
    const timer = setTimer.mock.results[setTimer.mock.calls.findIndex(([, delay]) => delay === 30000)].value;
    const { id } = FakeWorker.last.posted[0];
    FakeWorker.last.onmessage!({
      data: { id, success: true, result: { success: true, formattedCode: 'from worker' } },
    });
    await expect(pending).resolves.toEqual({ success: true, formattedCode: 'from worker' });
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });

  it('dispose clears the timers of what was waiting', async () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const pending = engine.formatCode(LARGE, options);
    const timer = setTimer.mock.results[setTimer.mock.calls.findIndex(([, delay]) => delay === 30000)].value;
    engine.dispose();
    await pending;
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });
});
