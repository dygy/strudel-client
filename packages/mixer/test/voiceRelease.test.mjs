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
    expect(param.calls).toEqual([
      ['cancelScheduledValues', 10],
      ['setTargetAtTime', 0, 10, 1],
    ]);
    expect(param.calls.filter(([m]) => m === 'setValueAtTime' || m === 'value=')).toEqual([]);
    expect(voice.stop).toHaveBeenCalledWith(16);
  });

  it('without cancelAndHoldAtTime, the envelope’s pending sustain step at the note end is cancelled', () => {
    // A timeline param: events sorted by time; cancelScheduledValues(t) drops those at or after t.
    const events = [];
    const param = {
      value: 0,
      setValueAtTime: (v, t) => events.push(['set', v, t]),
      linearRampToValueAtTime: (v, t) => events.push(['ramp', v, t]),
      setTargetAtTime: (v, t, tau) => events.push(['target', v, t, tau]),
      cancelScheduledValues: (t) => events.splice(0, events.length, ...events.filter(([, , time]) => time < t)),
    };
    // getParamADSR for a note from 0 to 20 s: attack, decay, sustain step at the end, release.
    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(1, 0.01);
    param.linearRampToValueAtTime(0.6, 0.1);
    param.setValueAtTime(0.6, 20);
    param.linearRampToValueAtTime(0, 20.5);

    releaseSoundHandle(handle(param), 10, 16);

    const fromStart = events.filter(([, , t]) => t >= 10);
    expect(fromStart).toEqual([['target', 0, 10, 1]]); // nothing can step the gain back up
    expect(events.slice(0, 3)).toEqual([
      ['set', 0, 0],
      ['ramp', 1, 0.01],
      ['ramp', 0.6, 0.1],
    ]); // the past is untouched
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
