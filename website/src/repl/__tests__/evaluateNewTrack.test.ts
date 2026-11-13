/**
 * @spec: 022-set-playlist (2.3 Go with the item's transition, 2.5 failed Go; tech §2.4)
 * evaluateNewTrack with a per-switch override: the item's type decides the path (Crossfade while the
 * global type is Off; Cut while it is Crossfade), snap/glide/loudness stay global, a queued Go keeps
 * its item's transition, and a failed evaluate is reported. Without an override: spec 017 unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateNewTrack, type EvaluateNewTrackDeps } from '../evaluateNewTrack';
import { DEFAULT_TRANSITION, type TransitionSettings } from '../transitionSettings';

function setup({
  global = { ...DEFAULT_TRANSITION },
  playing = true,
  busy = false,
  evaluateResult = { pattern: true } as unknown,
  switchTo = vi.fn(async () => ({})),
}: {
  global?: TransitionSettings;
  playing?: boolean;
  busy?: boolean;
  evaluateResult?: unknown;
  switchTo?: ReturnType<typeof vi.fn>;
} = {}) {
  const repl = {
    scheduler: { started: playing },
    evaluate: vi.fn(async () => evaluateResult),
    stop: vi.fn(),
  };
  const controller = { busy, switchTo };
  const deps: EvaluateNewTrackDeps = {
    repl,
    globalSettings: () => global,
    controllerBusy: () => busy,
    getController: () => controller,
    flash: vi.fn(),
    resetBeforeTransition: vi.fn(async () => {}),
    cleanupCanvases: vi.fn(async () => {}),
    setRestarting: vi.fn(),
  };
  return { deps, repl, controller, switchTo };
}

describe('evaluateNewTrack with a set item transition', () => {
  it('a Crossfade item goes through the controller even while the global type is Off', async () => {
    const { deps, switchTo, repl } = setup({ global: { ...DEFAULT_TRANSITION, type: 'off', snap: 4, glide: true } });
    expect(await evaluateNewTrack(deps, 'code', { restart: true, transition: { type: 'crossfade', length: 8 } })).toBe(
      'ok',
    );
    expect(switchTo).toHaveBeenCalledWith(
      'code',
      { ...DEFAULT_TRANSITION, type: 'crossfade', length: 8, snap: 4, glide: true },
      {
        prepare: undefined,
      },
    );
    expect(repl.evaluate).not.toHaveBeenCalled();
    expect(repl.stop).not.toHaveBeenCalled();
  });

  it('a Cut · 1 item overrides a global Crossfade', async () => {
    const { deps, switchTo } = setup({ global: { ...DEFAULT_TRANSITION, type: 'crossfade', length: 4 } });
    await evaluateNewTrack(deps, 'code', { transition: { type: 'cut', length: 1 } });
    expect(switchTo.mock.calls[0][1]).toMatchObject({ type: 'cut', length: 1 });
  });

  it('an Off item with a global Crossfade takes the instant path', async () => {
    const { deps, switchTo, repl } = setup({ global: { ...DEFAULT_TRANSITION, type: 'crossfade' } });
    expect(await evaluateNewTrack(deps, 'code', { restart: true, transition: { type: 'off', length: 4 } })).toBe('ok');
    expect(switchTo).not.toHaveBeenCalled();
    expect(repl.stop).toHaveBeenCalled();
    expect(repl.evaluate).toHaveBeenCalledWith('code');
  });

  it('while busy, the item transition is passed explicitly (a queued Go keeps it)', async () => {
    const { deps, switchTo } = setup({ busy: true });
    await evaluateNewTrack(deps, 'code', { transition: { type: 'dip', length: 2 } });
    expect(switchTo.mock.calls[0][1]).toMatchObject({ type: 'dip', length: 2 });
  });

  it('while busy without an override, the settings are left to the controller (spec 017 unchanged)', async () => {
    const { deps, switchTo } = setup({ busy: true, global: { ...DEFAULT_TRANSITION, type: 'crossfade' } });
    await evaluateNewTrack(deps, 'code');
    expect(switchTo.mock.calls[0][1]).toBeUndefined();
  });

  it('Default (null) uses the global settings as they are at the Go', async () => {
    const global = { ...DEFAULT_TRANSITION, type: 'dip' as const, length: 4 as const };
    const { deps, switchTo } = setup({ global });
    await evaluateNewTrack(deps, 'code', { transition: null });
    expect(switchTo.mock.calls[0][1]).toEqual(global);
  });

  it('with nothing playing, even a Crossfade item simply starts (no transition)', async () => {
    const { deps, switchTo, repl } = setup({ playing: false });
    await evaluateNewTrack(deps, 'code', { transition: { type: 'crossfade', length: 8 } });
    expect(switchTo).not.toHaveBeenCalled();
    expect(repl.evaluate).toHaveBeenCalledWith('code');
  });
});

describe('the result', () => {
  it("a transition whose new code doesn't evaluate is 'failed', and nothing else is tried", async () => {
    const error = Object.assign(new Error('boom'), { evaluateFailed: true });
    const { deps, repl } = setup({ switchTo: vi.fn(async () => Promise.reject(error)) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await evaluateNewTrack(deps, 'bad', { transition: { type: 'crossfade', length: 4 } })).toBe('failed');
    expect(repl.evaluate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("the instant path is 'failed' when the repl reports an error (resolves without a pattern)", async () => {
    // The core repl resolves undefined after an error; null here, since undefined takes the default.
    const { deps } = setup({ playing: false, evaluateResult: null });
    expect(await evaluateNewTrack(deps, 'bad')).toBe('failed');
  });

  it("the instant path is 'ok' when the pattern lands", async () => {
    const { deps } = setup({ playing: false });
    expect(await evaluateNewTrack(deps, 'good')).toBe('ok');
  });

  it('a transition failing for another reason falls back to an instant switch', async () => {
    const { deps, repl } = setup({ switchTo: vi.fn(async () => Promise.reject(new Error('graph'))) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await evaluateNewTrack(deps, 'code', { restart: true, transition: { type: 'crossfade', length: 4 } })).toBe(
      'ok',
    );
    expect(repl.stop).toHaveBeenCalled();
    expect(repl.evaluate).toHaveBeenCalledWith('code');
    error.mockRestore();
  });
});

// Review 022 #1: a set Go to a broken track on the Off type stopped the speakers before the evaluate
// failed, so nothing played. A set Go must leave the old track playing (spec 2.5).
describe('a set Go (keepOldOnFailure) never silences the speakers for a broken track', () => {
  const evaluateFailed = () => Object.assign(new Error('boom'), { evaluateFailed: true });

  it.each([
    [
      'the global type Off (Default item)',
      { ...DEFAULT_TRANSITION, type: 'off' as const, snap: 4 as const, glide: true },
      null,
    ],
    [
      'an Off item',
      { ...DEFAULT_TRANSITION, type: 'crossfade' as const },
      { type: 'off' as const, length: 4 as const },
    ],
  ])(
    'with %s, a failed Go leaves the old track playing: no stop, result failed',
    async (_label, global, transition) => {
      const { deps, repl, switchTo } = setup({ global, switchTo: vi.fn(async () => Promise.reject(evaluateFailed())) });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await evaluateNewTrack(deps, 'broken', { restart: true, transition, keepOldOnFailure: true })).toBe(
        'failed',
      );
      expect(repl.stop).not.toHaveBeenCalled();
      expect(repl.evaluate).not.toHaveBeenCalled();
      // A Cut through the controller, with none of the modifiers: the same hard switch as Off.
      expect(switchTo.mock.calls[0][1]).toMatchObject({ type: 'cut', snap: 0, glide: false, matchLoudness: false });
      warn.mockRestore();
    },
  );

  it('a good Off Go switches through the controller as that Cut', async () => {
    const { deps, repl, switchTo } = setup();
    expect(await evaluateNewTrack(deps, 'good', { restart: true, keepOldOnFailure: true })).toBe('ok');
    expect(switchTo).toHaveBeenCalledTimes(1);
    expect(repl.stop).not.toHaveBeenCalled();
  });

  it('with nothing playing a set Go stays the instant path (nothing to keep)', async () => {
    const { deps, switchTo, repl } = setup({ playing: false });
    await evaluateNewTrack(deps, 'code', { restart: true, keepOldOnFailure: true });
    expect(switchTo).not.toHaveBeenCalled();
    expect(repl.evaluate).toHaveBeenCalledWith('code');
  });

  it('a plain (non-set) Off switch keeps spec 017 unchanged: the instant path, stop first', async () => {
    const { deps, switchTo, repl } = setup();
    await evaluateNewTrack(deps, 'code', { restart: true });
    expect(switchTo).not.toHaveBeenCalled();
    expect(repl.stop).toHaveBeenCalled();
  });
});
