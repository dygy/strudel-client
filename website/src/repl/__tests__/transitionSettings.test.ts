/**
 * Transition settings (spec 017 §2.1–2.3, tech §2.5): parsing of the stored values, the
 * greyed-out rules, the one-time migration from the old smooth-transitions key, and which path
 * a switch takes (Off keeps today's instant path).
 */
import { describe, expect, it, vi } from 'vitest';
import { TRANSITION_LENGTHS, TRANSITION_SNAPS } from '../../../../packages/mixer/TrackTransitionController.mjs';
import { TRANSITION_TYPES as BUILDER_TYPES } from '../../../../packages/mixer/transitions/buildTransition.mjs';
import {
  DEFAULT_TRANSITION,
  LEGACY_SMOOTH_TRANSITIONS_KEY,
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_SNAP_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  areModifiersDisabled,
  isGlideDisabled,
  isLengthDisabled,
  legacyTransitionUpdates,
  migrateLegacySmoothTransitions,
  nearestTransitionLength,
  parseTransitionSettings,
  switchPath,
} from '../transitionSettings';

/** A Storage stand-in holding plain strings, like localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    removeItem: (key: string) => void data.delete(key),
  };
}

const PREFIX = 'strudel-settings';

function migrate(initial: Record<string, string>) {
  const storage = fakeStorage(initial);
  const written: Record<string, string | number> = {};
  const migrated = migrateLegacySmoothTransitions({
    storage,
    settingsPrefix: PREFIX,
    setKey: (key, value) => {
      written[key] = value;
    },
  });
  return { migrated, written, storage };
}

describe('the option lists match @strudel/mixer', () => {
  it('types, lengths and snaps are the ones the controller accepts', () => {
    expect([...TRANSITION_TYPE_OPTIONS].sort()).toEqual([...BUILDER_TYPES].sort());
    expect([...TRANSITION_LENGTH_OPTIONS]).toEqual([...TRANSITION_LENGTHS]);
    expect([...TRANSITION_SNAP_OPTIONS]).toEqual([...TRANSITION_SNAPS]);
  });

  it('eight types, Off first', () => {
    expect(TRANSITION_TYPE_OPTIONS).toEqual([
      'off',
      'dip',
      'cut',
      'crossfade',
      'filterSweep',
      'bassSwap',
      'echoOut',
      'layeredIntro',
    ]);
  });
});

describe('parseTransitionSettings', () => {
  it('defaults: Off, 4 cycles, no snap, modifiers off', () => {
    expect(parseTransitionSettings({})).toEqual({
      type: 'off',
      length: 4,
      snap: 0,
      glide: false,
      matchLoudness: false,
    });
    expect(DEFAULT_TRANSITION.type).toBe('off');
  });

  it('reads the strings persistentMap stores', () => {
    expect(
      parseTransitionSettings({
        transitionType: 'echoOut',
        transitionLength: '16',
        transitionSnap: '4',
        transitionGlide: 'true',
        transitionMatchLoudness: 'true',
      }),
    ).toEqual({ type: 'echoOut', length: 16, snap: 4, glide: true, matchLoudness: true });
  });

  it('unknown or out-of-range values fall back to the defaults', () => {
    expect(
      parseTransitionSettings({
        transitionType: 'smooth',
        transitionLength: '3',
        transitionSnap: '2',
        transitionGlide: 'yes',
        transitionMatchLoudness: 'false',
      }),
    ).toEqual({ type: 'off', length: 4, snap: 0, glide: false, matchLoudness: false });
  });
});

describe('greyed-out states (spec 2.2, 2.3)', () => {
  it('Length is off for Off and Cut only', () => {
    expect(TRANSITION_TYPE_OPTIONS.filter(isLengthDisabled)).toEqual(['off', 'cut']);
  });

  it('Tempo glide is off for Off, Dip and Cut only', () => {
    expect(TRANSITION_TYPE_OPTIONS.filter(isGlideDisabled)).toEqual(['off', 'dip', 'cut']);
  });

  it('all modifiers are off for Off only', () => {
    expect(TRANSITION_TYPE_OPTIONS.filter(areModifiersDisabled)).toEqual(['off']);
  });
});

describe('migration from strudel-smooth-transitions', () => {
  it('on → Dip; the seconds become cycles at 2 s per cycle (4 s → 2 cycles)', () => {
    const { migrated, written, storage } = migrate({
      [LEGACY_SMOOTH_TRANSITIONS_KEY]: JSON.stringify({ enabled: true, duration: 4 }),
    });
    expect(migrated).toBe(true);
    expect(written).toEqual({ transitionType: 'dip', transitionLength: 2 });
    expect(storage.data.has(LEGACY_SMOOTH_TRANSITIONS_KEY)).toBe(false);
  });

  it('off → Off', () => {
    const { written } = migrate({
      [LEGACY_SMOOTH_TRANSITIONS_KEY]: JSON.stringify({ enabled: false, duration: 2 }),
    });
    expect(written).toEqual({ transitionType: 'off', transitionLength: 1 });
  });

  it('a tie rounds down to the shorter length (3 s = 1.5 cycles → 1)', () => {
    expect(legacyTransitionUpdates(JSON.stringify({ enabled: true, duration: 3 }))).toEqual({
      transitionType: 'dip',
      transitionLength: 1,
    });
    expect(nearestTransitionLength(1.5)).toBe(1);
    expect(nearestTransitionLength(3)).toBe(2);
    expect(nearestTransitionLength(5)).toBe(4);
    expect(nearestTransitionLength(100)).toBe(16);
  });

  it('absent: nothing is written and the defaults stay', () => {
    const { migrated, written } = migrate({});
    expect(migrated).toBe(false);
    expect(written).toEqual({});
  });

  it('no duration keeps the default length; only the type is written', () => {
    expect(legacyTransitionUpdates(JSON.stringify({ enabled: true }))).toEqual({ transitionType: 'dip' });
  });

  it('runs once: a type already stored wins, and the old key is still removed', () => {
    const { migrated, written, storage } = migrate({
      [LEGACY_SMOOTH_TRANSITIONS_KEY]: JSON.stringify({ enabled: true, duration: 4 }),
      [`${PREFIX}transitionType`]: 'crossfade',
    });
    expect(migrated).toBe(false);
    expect(written).toEqual({});
    expect(storage.data.has(LEGACY_SMOOTH_TRANSITIONS_KEY)).toBe(false);
  });

  it('an unreadable value migrates as Off', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(legacyTransitionUpdates('{not json')).toEqual({ transitionType: 'off' });
    vi.restoreAllMocks();
  });
});

describe('which path a switch takes', () => {
  it('Off while playing: the instant path (stop, reset, evaluate), as today', () => {
    expect(switchPath({ type: 'off', playing: true, busy: false })).toBe('instant');
  });

  it('every other type while playing goes through the transition controller', () => {
    for (const type of TRANSITION_TYPE_OPTIONS.filter((t) => t !== 'off')) {
      expect(switchPath({ type, playing: true, busy: false })).toBe('transition');
    }
  });

  it('nothing playing: the track starts straight away, whatever the type', () => {
    expect(switchPath({ type: 'crossfade', playing: false, busy: false })).toBe('instant');
  });

  it('while a transition runs, even Off goes to the controller (it queues, never cuts the blend)', () => {
    expect(switchPath({ type: 'off', playing: true, busy: true })).toBe('transition');
  });
});
