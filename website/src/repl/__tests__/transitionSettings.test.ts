/**
 * Transition settings (spec 017 §2.1–2.3, tech §2.5; spec 027 §2.1–2.2, tech §2.3): parsing of the
 * stored values (Snap 16, the Tempo choice and its migration from Tempo glide), the greyed-out
 * rules, the one-time migrations, and which path a switch takes (Off keeps today's instant path).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  TRANSITION_LENGTHS,
  TRANSITION_SNAPS,
  TRANSITION_TEMPOS,
} from '../../../../packages/mixer/TrackTransitionController.mjs';
import { TRANSITION_TYPES as BUILDER_TYPES } from '../../../../packages/mixer/transitions/buildTransition.mjs';
import {
  DEFAULT_TRANSITION,
  LEGACY_SMOOTH_TRANSITIONS_KEY,
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_SNAP_OPTIONS,
  TRANSITION_TEMPO_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  areModifiersDisabled,
  isLengthDisabled,
  isTempoOptionDisabled,
  legacyTransitionUpdates,
  migrateLegacySmoothTransitions,
  migrateLegacyTempoGlide,
  nearestTransitionLength,
  parseTransitionSettings,
  switchPath,
  transitionSnapLabelKey,
  transitionTempoDescriptionKey,
  transitionTempoLabelKey,
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
    expect([...TRANSITION_TEMPO_OPTIONS]).toEqual([...TRANSITION_TEMPOS]);
  });

  it('spec 027: snaps are Off, 1, 4, 8, 16; tempos are Jump, Glide during, Match then glide, Keep', () => {
    expect([...TRANSITION_SNAP_OPTIONS]).toEqual([0, 1, 4, 8, 16]);
    expect([...TRANSITION_TEMPO_OPTIONS]).toEqual(['jump', 'glide', 'match', 'keep']);
    expect(transitionSnapLabelKey(16)).toBe('transitionSnapNext16');
    expect(TRANSITION_TEMPO_OPTIONS.map(transitionTempoLabelKey)).toEqual([
      'transitionTempoJump',
      'transitionTempoGlide',
      'transitionTempoMatch',
      'transitionTempoKeep',
    ]);
    expect(transitionTempoDescriptionKey('match')).toBe('transitionTempoMatchDescription');
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
      tempo: 'jump',
      matchLoudness: false,
    });
    expect(DEFAULT_TRANSITION.type).toBe('off');
    expect(DEFAULT_TRANSITION.tempo).toBe('jump');
    expect(DEFAULT_TRANSITION).not.toHaveProperty('glide');
  });

  it('reads the strings persistentMap stores', () => {
    expect(
      parseTransitionSettings({
        transitionType: 'echoOut',
        transitionLength: '16',
        transitionSnap: '4',
        transitionTempo: 'match',
        transitionMatchLoudness: 'true',
      }),
    ).toEqual({ type: 'echoOut', length: 16, snap: 4, tempo: 'match', matchLoudness: true });
  });

  it('unknown or out-of-range values fall back to the defaults', () => {
    expect(
      parseTransitionSettings({
        transitionType: 'smooth',
        transitionLength: '3',
        transitionSnap: '2',
        transitionTempo: 'fast',
        transitionGlide: 'yes',
        transitionMatchLoudness: 'false',
      }),
    ).toEqual({ type: 'off', length: 4, snap: 0, tempo: 'jump', matchLoudness: false });
  });

  it('spec 027: every Tempo value is read back as stored', () => {
    for (const tempo of TRANSITION_TEMPO_OPTIONS) {
      expect(parseTransitionSettings({ transitionTempo: tempo }).tempo).toBe(tempo);
    }
  });

  it('spec 027: Snap 16 is read back; Snap 2 or garbage is Off', () => {
    expect(parseTransitionSettings({ transitionSnap: '16' }).snap).toBe(16);
    expect(parseTransitionSettings({ transitionSnap: 16 }).snap).toBe(16);
    expect(parseTransitionSettings({ transitionSnap: '2' }).snap).toBe(0);
    expect(parseTransitionSettings({ transitionSnap: 'abc' }).snap).toBe(0);
  });

  describe('migration from Tempo glide (spec 027 §2.2)', () => {
    it("a saved Tempo glide on ('true' after a reload, or true) is Glide during", () => {
      expect(parseTransitionSettings({ transitionGlide: 'true' }).tempo).toBe('glide');
      expect(parseTransitionSettings({ transitionGlide: true }).tempo).toBe('glide');
    });

    it('saved off, or nothing, is Jump', () => {
      expect(parseTransitionSettings({ transitionGlide: 'false' }).tempo).toBe('jump');
      expect(parseTransitionSettings({ transitionGlide: false }).tempo).toBe('jump');
      expect(parseTransitionSettings({}).tempo).toBe('jump');
    });

    it('an unknown saved value is Jump', () => {
      expect(parseTransitionSettings({ transitionGlide: 'yes' }).tempo).toBe('jump');
      expect(parseTransitionSettings({ transitionTempo: 'fast' }).tempo).toBe('jump');
      expect(parseTransitionSettings({ transitionTempo: '' }).tempo).toBe('jump');
    });

    it('a stored Tempo choice wins over the legacy key; an invalid one falls back to it', () => {
      expect(parseTransitionSettings({ transitionTempo: 'jump', transitionGlide: 'true' }).tempo).toBe('jump');
      expect(parseTransitionSettings({ transitionTempo: 'keep', transitionGlide: 'true' }).tempo).toBe('keep');
      expect(parseTransitionSettings({ transitionTempo: 'fast', transitionGlide: 'true' }).tempo).toBe('glide');
    });

    it('the result never carries the old glide field', () => {
      expect(parseTransitionSettings({ transitionGlide: 'true' })).not.toHaveProperty('glide');
    });

    function migrateTempo(initial: Record<string, string>) {
      const storage = fakeStorage(initial);
      const written: Record<string, string | number> = {};
      const migrated = migrateLegacyTempoGlide({
        storage,
        settingsPrefix: PREFIX,
        setKey: (key, value) => {
          written[key] = value;
        },
      });
      return { migrated, written, storage };
    }

    it('before the store mounts: a stored glide on writes transitionTempo glide, off writes jump', () => {
      expect(migrateTempo({ [`${PREFIX}transitionGlide`]: 'true' })).toMatchObject({
        migrated: true,
        written: { transitionTempo: 'glide' },
      });
      expect(migrateTempo({ [`${PREFIX}transitionGlide`]: 'false' }).written).toEqual({ transitionTempo: 'jump' });
    });

    it('the legacy key is never written nor removed', () => {
      const { written, storage } = migrateTempo({ [`${PREFIX}transitionGlide`]: 'true' });
      expect(Object.keys(written)).toEqual(['transitionTempo']);
      expect(storage.data.get(`${PREFIX}transitionGlide`)).toBe('true');
    });

    it('negative: a stored Tempo choice is never overwritten; no legacy key writes nothing', () => {
      expect(
        migrateTempo({ [`${PREFIX}transitionGlide`]: 'true', [`${PREFIX}transitionTempo`]: 'jump' }),
      ).toMatchObject({ migrated: false, written: {} });
      expect(migrateTempo({})).toMatchObject({ migrated: false, written: {} });
    });
  });
});

describe('greyed-out states (spec 2.2, 2.3)', () => {
  it('Length is off for Off and Cut only', () => {
    expect(TRANSITION_TYPE_OPTIONS.filter(isLengthDisabled)).toEqual(['off', 'cut']);
  });

  it('spec 027: Glide during is off for Off, Dip, Cut and Echo-out only', () => {
    expect(TRANSITION_TYPE_OPTIONS.filter((type) => isTempoOptionDisabled(type, 'glide'))).toEqual([
      'off',
      'dip',
      'cut',
      'echoOut',
    ]);
  });

  it('review 027 finding 3: Glide during is off for Echo-out, on for the overlapping types', () => {
    expect(isTempoOptionDisabled('echoOut', 'glide')).toBe(true);
    for (const type of ['crossfade', 'filterSweep', 'bassSwap', 'layeredIntro'] as const) {
      expect(isTempoOptionDisabled(type, 'glide')).toBe(false);
    }
    expect(TRANSITION_TEMPO_OPTIONS.filter((tempo) => isTempoOptionDisabled('echoOut', tempo))).toEqual(['glide']);
  });

  it('spec 027: Jump, Match then glide and Keep set tempo are off for Off only', () => {
    for (const tempo of ['jump', 'match', 'keep'] as const) {
      expect(TRANSITION_TYPE_OPTIONS.filter((type) => isTempoOptionDisabled(type, tempo))).toEqual(['off']);
    }
  });

  it('spec 027: every Tempo option is off for Off; for Dip and Cut only Glide during', () => {
    expect(TRANSITION_TEMPO_OPTIONS.filter((tempo) => isTempoOptionDisabled('off', tempo))).toEqual([
      ...TRANSITION_TEMPO_OPTIONS,
    ]);
    expect(TRANSITION_TEMPO_OPTIONS.filter((tempo) => isTempoOptionDisabled('dip', tempo))).toEqual(['glide']);
    expect(TRANSITION_TEMPO_OPTIONS.filter((tempo) => isTempoOptionDisabled('cut', tempo))).toEqual(['glide']);
    expect(TRANSITION_TEMPO_OPTIONS.filter((tempo) => isTempoOptionDisabled('crossfade', tempo))).toEqual([]);
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
