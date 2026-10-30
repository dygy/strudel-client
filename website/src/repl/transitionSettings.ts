/**
 * Transition settings for track switches (spec 017 §2.1–2.3): the type, the length in cycles
 * and the three modifiers. Stored per browser in `settingsMap` (website/src/settings.ts); this
 * module holds the pure parts: types, defaults, parsing of stored (string) values, the
 * greyed-out rules, and the one-time migration from the old smooth-transitions key.
 *
 * The lists mirror @strudel/mixer's TRANSITION_TYPES / TRANSITION_LENGTHS / TRANSITION_SNAPS;
 * a test keeps them equal.
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

export const TRANSITION_SNAP_OPTIONS = [0, 1, 4, 8] as const;
export type TransitionSnap = (typeof TRANSITION_SNAP_OPTIONS)[number];

export interface TransitionSettings {
  type: TransitionType;
  length: TransitionLength;
  snap: TransitionSnap;
  glide: boolean;
  matchLoudness: boolean;
}

export const DEFAULT_TRANSITION: TransitionSettings = Object.freeze({
  type: 'off',
  length: 4,
  snap: 0,
  glide: false,
  matchLoudness: false,
});

/** The settingsMap keys (persistentMap stores every value as a string). */
export interface RawTransitionSettings {
  transitionType?: string;
  transitionLength?: number | string;
  transitionSnap?: number | string;
  transitionGlide?: boolean | string;
  transitionMatchLoudness?: boolean | string;
}

export const TRANSITION_SETTING_KEYS = [
  'transitionType',
  'transitionLength',
  'transitionSnap',
  'transitionGlide',
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
    glide: asBoolean(raw.transitionGlide),
    matchLoudness: asBoolean(raw.transitionMatchLoudness),
  };
}

/** Length has no meaning for Off and Cut (spec 2.2). */
export const isLengthDisabled = (type: TransitionType): boolean => type === 'off' || type === 'cut';
/** Modifiers apply to every type except Off (spec 2.3). */
export const areModifiersDisabled = (type: TransitionType): boolean => type === 'off';
/** Tempo glide has no audible effect for Dip and Cut (spec 2.3), nor for Off. */
export const isGlideDisabled = (type: TransitionType): boolean => type === 'off' || type === 'dip' || type === 'cut';

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
export function settingsForSwitch(settings: TransitionSettings, busy: boolean): TransitionSettings | undefined {
  return busy ? undefined : settings;
}
