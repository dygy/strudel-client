/**
 * @spec: 024-track-eq-profile (functional §2.1, §2.2; tech §2.2)
 * The playing-profile store follows what the speakers play: an evaluate sets it, a stop clears it, an
 * unchanged line keeps the same object (a stable snapshot) and warns once, a broken line warns and
 * gives none, and nothing throws. useReplContext calls it from afterEval and onToggle(false), next to
 * trackSwitch (checked in its source, as scratchReplWiring does: rendering the REPL is too slow).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPlayingEqProfile,
  playingCodeEvaluated,
  playingStopped,
  resetPlayingEqProfile,
  subscribePlayingEqProfile,
} from '../playingEqProfile';

const PHONK = '// @eq-profile {"v":1,"preset":"phonk","why":"sub light"}\ns("bd*4")';
const TRAP = '// @eq-profile {"v":1,"preset":"trap"}\ns("bd*4")';

afterEach(() => {
  resetPlayingEqProfile();
  vi.restoreAllMocks();
});

describe('playingEqProfile', () => {
  it('an evaluate sets the profile and notifies; a stop clears it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlayingEqProfile(listener);
    playingCodeEvaluated(PHONK);
    expect(getPlayingEqProfile()).toMatchObject({ preset: 'phonk', why: 'sub light' });
    expect(listener).toHaveBeenCalledTimes(1);
    playingStopped();
    expect(getPlayingEqProfile()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    playingCodeEvaluated(PHONK);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('the same line keeps the same object and does not notify; another line replaces it', () => {
    playingCodeEvaluated(PHONK);
    const first = getPlayingEqProfile();
    const listener = vi.fn();
    subscribePlayingEqProfile(listener);
    playingCodeEvaluated(`${PHONK}\n.gain(0.8)`); // the music changed, the line did not
    expect(getPlayingEqProfile()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
    playingCodeEvaluated(TRAP);
    expect(getPlayingEqProfile()?.preset).toBe('trap');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('code without a line clears it', () => {
    playingCodeEvaluated(PHONK);
    playingCodeEvaluated('s("bd*4")');
    expect(getPlayingEqProfile()).toBeNull();
  });

  it('a broken line gives no profile and warns once per distinct line, never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    playingCodeEvaluated(PHONK);
    const broken = '// @eq-profile {"v":2,"preset":"phonk"}\ns("bd")';
    expect(() => playingCodeEvaluated(broken)).not.toThrow();
    expect(getPlayingEqProfile()).toBeNull();
    playingCodeEvaluated(broken);
    playingCodeEvaluated(broken);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[EQ profile\] ignored: unknown version 2/);
    playingCodeEvaluated('// @eq-profile {nope\ns("bd")');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(() => playingCodeEvaluated(undefined as unknown as string)).not.toThrow();
  });

  it('a stop forgets the line, so the same broken line warns again on the next play', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = '// @eq-profile {"v":1}';
    playingCodeEvaluated(broken);
    playingStopped();
    playingCodeEvaluated(broken);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('useReplContext wiring', () => {
  const source = readFileSync(resolve(__dirname, '../useReplContext.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('afterEval hands the evaluated code to the store, next to trackSwitch.evaluated', () => {
    expect(source).toMatch(/trackSwitch\.evaluated\(code\);\s*playingCodeEvaluated\(code\);/);
  });

  it('onToggle(false) clears it, next to trackSwitch.stopped', () => {
    expect(source).toMatch(/trackSwitch\.stopped\(\);\s*playingStopped\(\);/);
  });
});
