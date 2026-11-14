/**
 * Transition settings for track switches (spec 017 §2.1–2.3, spec 027): the type, the length in
 * cycles and the three modifiers (Snap to, Tempo, Match loudness). Stored per browser in `settingsMap` (website/src/settings.ts); this
 * module holds the pure parts: types, defaults, parsing of stored (string) values, the
 * greyed-out rules, and the one-time migrations from the old smooth-transitions key and from the
 * old Tempo glide checkbox.
 *
 * The lists mirror @strudel/mixer's TRANSITION_TYPES / TRANSITION_LENGTHS / TRANSITION_SNAPS /
 * TRANSITION_TEMPOS; a test keeps them equal.
 */

export const TRANSITION_TYPE_OPTIONS = [
  'off',
  'dip',
  'cut',
  'crossfade',
  'filterSweep',
  'bassSwap',
  'echoOut',
  'layeredIntro',
] as const;
export type TransitionType = (typeof TRANSITION_TYPE_OPTIONS)[number];

export const TRANSITION_LENGTH_OPTIONS = [1, 2, 4, 8, 16] as const;
export type TransitionLength = (typeof TRANSITION_LENGTH_OPTIONS)[number];

/** Phrase boundaries, counted from the playing track's own cycle 0 (spec 027 §2.1). */
export const TRANSITION_SNAP_OPTIONS = [0, 1, 4, 8, 16] as const;
export type TransitionSnap = (typeof TRANSITION_SNAP_OPTIONS)[number];

/**
 * How the tempo moves (spec 027 §2.2): Jump (the new tempo at once), Glide during (old → new over
 * the transition), Match then glide (old tempo during it, then a slide to the new one), Keep set
 * tempo (the new track stays at the old tempo).
 */
export const TRANSITION_TEMPO_OPTIONS = ['jump', 'glide', 'match', 'keep'] as const;
export type TransitionTempo = (typeof TRANSITION_TEMPO_OPTIONS)[number];

export interface TransitionSettings {
  type: TransitionType;
  length: TransitionLength;
  snap: TransitionSnap;
  tempo: TransitionTempo;
  matchLoudness: boolean;
}

export const DEFAULT_TRANSITION: TransitionSettings = Object.freeze({
  type: 'off',
  length: 4,
  snap: 0,
  tempo: 'jump',
  matchLoudness: false,
});

/** The settingsMap keys (persistentMap stores every value as a string). */
export interface RawTransitionSettings {
  transitionType?: string;
  transitionLength?: number | string;
  transitionSnap?: number | string;
  transitionTempo?: string;
  /** Pre-027 Tempo glide checkbox: read (migrated to `transitionTempo`), never written. */
  transitionGlide?: boolean | string;
  transitionMatchLoudness?: boolean | string;
}

export const TRANSITION_SETTING_KEYS = [
  'transitionType',
  'transitionLength',
  'transitionSnap',
  'transitionTempo',
  'transitionMatchLoudness',
] as const;

/** The pre-017 localStorage key of SmoothTransitionManager: `{ enabled, duration }` (seconds). */
export const LEGACY_SMOOTH_TRANSITIONS_KEY = 'strudel-smooth-transitions';
/** The migration converts seconds at the default tempo: one cycle = 2 seconds. */
const SECONDS_PER_CYCLE = 2;

const asBoolean = (value: unknown): boolean => value === true || value === 'true';

export function isTransitionType(value: unknown): value is TransitionType {
  return typeof value === 'string' && (TRANSITION_TYPE_OPTIONS as readonly string[]).includes(value);
}

export function isTransitionTempo(value: unknown): value is TransitionTempo {
  return typeof value === 'string' && (TRANSITION_TEMPO_OPTIONS as readonly string[]).includes(value);
}

/**
 * The Tempo choice from stored values (spec 027 §2.2 migration): a valid `transitionTempo` wins;
 * otherwise the old Tempo glide checkbox on (`true`, or `'true'` after a reload) is Glide during;
 * anything else is Jump.
 */
export function parseTransitionTempo(
  raw: Pick<RawTransitionSettings, 'transitionTempo' | 'transitionGlide'>,
): TransitionTempo {
  if (isTransitionTempo(raw.transitionTempo)) {
    return raw.transitionTempo;
  }
  return asBoolean(raw.transitionGlide) ? 'glide' : DEFAULT_TRANSITION.tempo;
}

/** The offered length closest to `cycles`; ties go to the shorter one (3 s = 1.5 cycles → 1). */
export function nearestTransitionLength(cycles: number): TransitionLength {
  return TRANSITION_LENGTH_OPTIONS.reduce<TransitionLength>(
    (best, option) => (Math.abs(option - cycles) < Math.abs(best - cycles) ? option : best),
    TRANSITION_LENGTH_OPTIONS[0],
  );
}

/** Stored values → typed settings; anything missing or unknown takes its default. */
export function parseTransitionSettings(raw: RawTransitionSettings = {}): TransitionSettings {
  const length = Number(raw.transitionLength);
  const snap = Number(raw.transitionSnap);
  return {
    type: isTransitionType(raw.transitionType) ? raw.transitionType : DEFAULT_TRANSITION.type,
    length: (TRANSITION_LENGTH_OPTIONS as readonly number[]).includes(length)
      ? (length as TransitionLength)
      : DEFAULT_TRANSITION.length,
    snap: (TRANSITION_SNAP_OPTIONS as readonly number[]).includes(snap) ? (snap as TransitionSnap) : 0,
    tempo: parseTransitionTempo(raw),
    matchLoudness: asBoolean(raw.transitionMatchLoudness),
  };
}

/** Length has no meaning for Off and Cut (spec 2.2). */
export const isLengthDisabled = (type: TransitionType): boolean => type === 'off' || type === 'cut';
/** Modifiers apply to every type except Off (spec 2.3). */
export const areModifiersDisabled = (type: TransitionType): boolean => type === 'off';
/** Types the tempo can't glide across (spec 027 §2.2): the controller plays Glide during as Jump. */
const NO_GLIDE_TYPES: readonly TransitionType[] = ['dip', 'cut', 'echoOut'];

/**
 * Whether a Tempo option is greyed out (spec 027 §2.2): every option for Off (modifiers don't
 * apply); Glide during for Dip, Cut and Echo-out, which the controller never glides (they aren't
 * overlapping types). Match then glide and Keep set tempo do work for them. A stored Glide during
 * with one of these types stays selected (greyed out) and the controller plays it as Jump.
 */
export const isTempoOptionDisabled = (type: TransitionType, tempo: TransitionTempo): boolean =>
  type === 'off' || (tempo === 'glide' && NO_GLIDE_TYPES.includes(type));

/**
 * What the old smooth-transitions value becomes (spec 2.1, 2.2; tech §2.5): `enabled` → Dip,
 * otherwise Off; `duration` in seconds → the nearest length in cycles at 2 s per cycle.
 * Returns null when there is nothing to migrate.
 */
export function legacyTransitionUpdates(stored: string | null): Partial<RawTransitionSettings> | null {
  if (stored === null) {
    return null;
  }
  let parsed: { enabled?: unknown; duration?: unknown } = {};
  try {
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === 'object') {
      parsed = value as { enabled?: unknown; duration?: unknown };
    }
  } catch (error: unknown) {
    console.warn('[settings] unreadable smooth-transitions value, migrating as Off:', error);
  }
  const updates: Partial<RawTransitionSettings> = { transitionType: parsed.enabled === true ? 'dip' : 'off' };
  const seconds = Number(parsed.duration);
  if (parsed.duration !== undefined && parsed.duration !== null && Number.isFinite(seconds) && seconds > 0) {
    updates.transitionLength = nearestTransitionLength(seconds / SECONDS_PER_CYCLE);
  }
  return updates;
}

export interface LegacyMigrationDeps {
  storage: Pick<Storage, 'getItem' | 'removeItem'>;
  /** The settingsMap key prefix (`strudel-settings` or `strudel-settings<n>`). */
  settingsPrefix: string;
  setKey: (key: keyof RawTransitionSettings, value: string | number) => void;
}

/**
 * Run the one-time migration: only when the old key exists and the new type is not stored yet.
 * The old key is removed afterwards either way, so it never runs twice.
 * @returns whether settings were written
 */
export function migrateLegacySmoothTransitions({ storage, settingsPrefix, setKey }: LegacyMigrationDeps): boolean {
  const stored = storage.getItem(LEGACY_SMOOTH_TRANSITIONS_KEY);
  if (stored === null) {
    return false;
  }
  const alreadySet = storage.getItem(`${settingsPrefix}transitionType`) !== null;
  const updates = alreadySet ? null : legacyTransitionUpdates(stored);
  if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setKey(key as keyof RawTransitionSettings, value as string | number);
      }
    }
  }
  storage.removeItem(LEGACY_SMOOTH_TRANSITIONS_KEY);
  return Boolean(updates);
}

/**
 * One-time migration of the old Tempo glide checkbox (spec 027 §2.2, tech §2.3). persistentMap
 * writes every default into storage when the store mounts, so the default `transitionTempo`
 * ('jump') would otherwise shadow a saved `transitionGlide` for good. It must run before the store
 * mounts: when `transitionGlide` is stored and `transitionTempo` isn't, `transitionTempo` is
 * written from it. `transitionGlide` itself is never written (nor removed).
 * @returns whether `transitionTempo` was written
 */
export function migrateLegacyTempoGlide({ storage, settingsPrefix, setKey }: LegacyMigrationDeps): boolean {
  const glide = storage.getItem(`${settingsPrefix}transitionGlide`);
  if (glide === null || storage.getItem(`${settingsPrefix}transitionTempo`) !== null) {
    return false;
  }
  setKey('transitionTempo', parseTransitionTempo({ transitionGlide: glide }));
  return true;
}

const KEY_SUFFIX: Record<TransitionType, string> = {
  off: 'Off',
  dip: 'Dip',
  cut: 'Cut',
  crossfade: 'Crossfade',
  filterSweep: 'FilterSweep',
  bassSwap: 'BassSwap',
  echoOut: 'EchoOut',
  layeredIntro: 'LayeredIntro',
};
/** `settings:` key of a type's name, e.g. `transitionTypeEchoOut`. */
export const transitionTypeLabelKey = (type: TransitionType): string => `transitionType${KEY_SUFFIX[type]}`;
/** `settings:` key of a type's one-line description, e.g. `transitionDescEchoOut`. */
export const transitionTypeDescriptionKey = (type: TransitionType): string => `transitionDesc${KEY_SUFFIX[type]}`;
/** `settings:` key of a snap option's label. */
export const transitionSnapLabelKey = (snap: TransitionSnap): string =>
  snap === 0 ? 'transitionSnapOff' : `transitionSnapNext${snap}`;

const TEMPO_KEY_SUFFIX: Record<TransitionTempo, string> = {
  jump: 'Jump',
  glide: 'Glide',
  match: 'Match',
  keep: 'Keep',
};
/** `settings:` key of a Tempo option's name, e.g. `transitionTempoMatch`. */
export const transitionTempoLabelKey = (tempo: TransitionTempo): string => `transitionTempo${TEMPO_KEY_SUFFIX[tempo]}`;
/** `settings:` key of a Tempo option's one-line description, e.g. `transitionTempoMatchDescription`. */
export const transitionTempoDescriptionKey = (tempo: TransitionTempo): string =>
  `${transitionTempoLabelKey(tempo)}Description`;

/**
 * How a track switch runs (spec 017 §2.1, §2.6; tech §2.1):
 * - `instant`: Off, or nothing playing. Today's path: stop, reset, clean up, evaluate.
 * - `transition`: any other type while playing, through TrackTransitionController. While a
 *   transition is in flight every switch (Off too) goes to the controller, which finishes the
 *   running one and then plays the latest pick.
 */
export function switchPath({
  type,
  playing,
  busy,
}: {
  type: TransitionType;
  playing: boolean;
  busy: boolean;
}): 'instant' | 'transition' {
  return busy || (playing && type !== 'off') ? 'transition' : 'instant';
}

/**
 * The settings to hand `controller.switchTo` (spec 017 §2.4: a switch uses the settings selected
 * when it BEGINS). Not busy: the switch begins now, so the snapshot taken now. Busy: the switch
 * is queued and begins when the running transition ends; `undefined` makes the controller read
 * the settings (its getSettings) at that moment.
 */
export function settingsForSwitch(
  settings: TransitionSettings,
  busy: boolean,
  explicit = false,
): TransitionSettings | undefined {
  // `explicit` (spec 022): a set item's own transition. A queued Go must keep it rather than read
  // the global settings when it begins, so it is always passed.
  return busy && !explicit ? undefined : settings;
}

/** A per-switch override of the type and length (spec 022: a set item's transition). */
export interface TransitionOverride {
  type: TransitionType;
  length: TransitionLength;
}

/**
 * The settings one switch uses: the global ones with `override`'s type and length (snap, tempo and
 * match loudness always stay global). No override (a set item on Default, or any non-set switch):
 * the global settings unchanged.
 */
export function withTransitionOverride(
  settings: TransitionSettings,
  override: TransitionOverride | null | undefined,
): TransitionSettings {
  return override ? { ...settings, type: override.type, length: override.length } : settings;
}
