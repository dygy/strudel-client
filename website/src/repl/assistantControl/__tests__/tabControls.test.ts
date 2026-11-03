/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * What a command reaches in this REPL: the library's own open, and only if it can really happen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTrackSelect } from '../openTrack';
import { createTabControls } from '../tabControls';

const controls = (fileManager: Record<string, unknown>, context: Record<string, unknown> = {}, phase = 'idle') =>
  createTabControls({
    live: () => ({ context, fileManager, t: (key: string) => key }),
    enabled: () => true,
    phase: () => phase as never,
  });

afterEach(() => {
  registerTrackSelect(null);
  vi.useRealTimers();
});

describe('openTrack', () => {
  it('says the library is not there, as in zen mode, and calls nothing', async () => {
    const refreshFromSupabase = vi.fn();
    const result = await controls({ tracks: { t: { id: 't' } }, refreshFromSupabase }).openTrack('t');
    expect(result).toBe('library_unavailable');
    expect(refreshFromSupabase).not.toHaveBeenCalled();
  });

  it('says opened only once the tab holds the track', async () => {
    const fileManager = { selectedTrack: 'a', tracks: { b: { id: 'b' } } };
    let editor = 'a';
    registerTrackSelect(() => {
      // As React does: a moment later.
      setTimeout(() => {
        fileManager.selectedTrack = 'b';
        editor = 'b';
      }, 60);
    });
    const context = { trackIds: () => ({ editor, playing: null }) };
    expect(await controls(fileManager, context).openTrack('b')).toBe('opened');
    expect(fileManager.selectedTrack).toBe('b');
  });

  it('says it failed when the tab never comes to hold it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fileManager = { selectedTrack: 'a', tracks: { b: { id: 'b' } } };
    registerTrackSelect(() => {});
    const reply = controls(fileManager, { trackIds: () => ({ editor: 'a', playing: null }) }).openTrack('b');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await reply).toBe('open_failed');
  });

  it("looks for a track an assistant just made, and says not_found if it's not there", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    registerTrackSelect(() => {});
    const refreshFromSupabase = vi.fn(async () => {});
    const reply = controls({ tracks: {}, refreshFromSupabase }).openTrack('absent');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await reply).toBe('not_found');
    expect(refreshFromSupabase).toHaveBeenCalledOnce();
  });
});

describe('update', () => {
  it('is the same runUpdate, and then waits on its own for the evaluate it started', async () => {
    let settle = () => {};
    const order: string[] = [];
    const context = {
      runUpdate: async () => (order.push('runUpdate'), 'switch'),
      evaluationsSettled: () => new Promise<void>((resolve) => (settle = resolve)),
    };
    let answered: unknown;
    void controls({}, context)
      .update()
      .then((value) => (answered = value));
    await new Promise((resolve) => setTimeout(resolve));
    expect(order).toEqual(['runUpdate']);
    expect(answered).toBeUndefined();
    settle();
    await new Promise((resolve) => setTimeout(resolve));
    expect(answered).toBe('switch');
  });

  it('says ignored without waiting for anything', async () => {
    const evaluationsSettled = vi.fn();
    const context = { runUpdate: async () => 'ignored', evaluationsSettled };
    expect(await controls({}, context).update()).toBe('ignored');
    expect(evaluationsSettled).not.toHaveBeenCalled();
  });
});

describe('saveEdits', () => {
  it('saves the track it was told, not whichever is selected', async () => {
    const saveSpecificTrack = vi.fn(async () => true);
    const saveCurrentTrack = vi.fn();
    await controls(
      { saveSpecificTrack, saveCurrentTrack },
      { trackIds: () => ({ editor: 't1', playing: null }) },
    ).saveEdits('t1');
    expect(saveSpecificTrack).toHaveBeenCalledWith('t1', false);
    expect(saveCurrentTrack).not.toHaveBeenCalled();
  });

  it('saves nothing when the editor holds another track', async () => {
    const saveSpecificTrack = vi.fn();
    const result = await controls(
      { saveSpecificTrack },
      { trackIds: () => ({ editor: 't2', playing: null }) },
    ).saveEdits('t1');
    expect(result).toBe(false);
    expect(saveSpecificTrack).not.toHaveBeenCalled();
  });
});

describe('transitionPhase', () => {
  it('says switching for a switch with no phase of its own, or one begun before the switch was on', () => {
    expect(controls({}, { isSwitching: () => true }).transitionPhase()).toBe('switching');
    expect(controls({}, { isSwitching: () => false }).transitionPhase()).toBe('idle');
  });

  it('gives the phase the events said, when there is one', () => {
    expect(controls({}, { isSwitching: () => true }, 'running').transitionPhase()).toBe('running');
  });
});
