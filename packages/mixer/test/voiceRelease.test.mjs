/**
 * superdough fork additions for spec 017 (getActiveSoundIds / releaseSounds / releaseSoundHandle):
 * the old track's voices fade to silence and stop, never with a jump, and ids that have already
 * ended are skipped without throwing.
 */

import { describe, it, expect, vi } from 'vitest';
import { getActiveSoundIds, releaseSoundHandle, releaseSounds } from 'superdough';
import { createAudioParam } from './webAudioMock.mjs';

/** A voice handle as superdough keeps it: `node` is the voice's output gain, `stop(t)` ends it. */
function handle(param = createAudioParam(1)) {
  return { node: { gain: param }, stop: vi.fn() };
}

describe('releaseSoundHandle', () => {
  it('holds the envelope at the start and ramps linearly to 0 by the end, then stops there', () => {
    const param = createAudioParam(1);
    param.cancelAndHoldAtTime = vi.fn((t) => param.calls.push(['cancelAndHoldAtTime', t]));
    const voice = handle(param);
    releaseSoundHandle(voice, 10, 14);
    expect(param.calls).toEqual([
      ['cancelAndHoldAtTime', 10],
      ['linearRampToValueAtTime', 0, 14],
    ]);
    expect(voice.stop).toHaveBeenCalledWith(14);
  });

  it('without cancelAndHoldAtTime (Firefox) it decays from the current value: no setValueAtTime jump', () => {
    const param = createAudioParam(1);
    param.setTargetAtTime = vi.fn((v, t, tau) => param.calls.push(['setTargetAtTime', v, t, tau]));
    const voice = handle(param);
    releaseSoundHandle(voice, 10, 16);
    expect(param.calls).toEqual([['setTargetAtTime', 0, 10, 1]]);
    expect(param.calls.filter(([m]) => m === 'setValueAtTime' || m === 'value=')).toEqual([]);
    expect(voice.stop).toHaveBeenCalledWith(16);
  });

  it('never throws: a voice that already ended (stop throws) or has no gain is fine', () => {
    const ended = {
      node: {},
      stop: vi.fn(() => {
        throw new Error('InvalidStateError');
      }),
    };
    expect(() => releaseSoundHandle(ended, 1, 2)).not.toThrow();
    expect(() => releaseSoundHandle(undefined, 1, 2)).not.toThrow();
  });

  it('an end at or before the start still ramps over a few ms (never an instant step)', () => {
    const param = createAudioParam(1);
    param.cancelAndHoldAtTime = vi.fn();
    releaseSoundHandle(handle(param), 10, 10);
    expect(param.calls.at(-1)[2]).toBeGreaterThan(10);
  });
});

describe('releaseSounds / getActiveSoundIds', () => {
  it('ids that are no longer active are skipped without throwing', () => {
    expect(releaseSounds([123456789, 987654321], 5, 4)).toBe(0);
    expect(releaseSounds(undefined, 5)).toBe(0);
  });

  it('lists nothing when the main engine has played nothing', () => {
    expect(getActiveSoundIds()).toEqual([]);
    expect(getActiveSoundIds({})).toEqual([]);
  });
});
