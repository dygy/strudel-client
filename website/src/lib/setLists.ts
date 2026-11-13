/**
 * Sets (spec 022): a named, ordered list of items that belongs to the signed-in user. One row of
 * `public.set_lists` per set; the items are a JSONB array on the row.
 *
 * Shared by the `/api/sets/*` routes (which refuse anything that doesn't pass) and the client (which
 * builds items that do). Tracks are not checked here: a deleted track simply shows Missing.
 */
import {
  TRANSITION_LENGTH_OPTIONS,
  TRANSITION_TYPE_OPTIONS,
  type TransitionLength,
  type TransitionType,
} from '../repl/transitionSettings';

/** The transition a set item is brought in with. `null` on the item means Default (the global one). */
export interface SetItemTransition {
  type: TransitionType;
  length: TransitionLength;
}

/** One entry of a set: a track, or one step of a multitrack. */
export interface SetItem {
  /** Stable per item, so the same track can be in a set twice and the position survives a reorder. */
  id: string;
  /** `tracks.id` */
  trackId: string;
  /** Only for a multitrack step. Step ids can repeat, so name and index are kept as fallbacks. */
  stepId?: string;
  stepName?: string;
  stepIndex?: number;
  /** `null` = Default: the global transition as it is at the moment of the Go. */
  transition: SetItemTransition | null;
}

/** A set as the API returns it. `version` is the row's `updated_at` (compare-and-swap token). */
export interface SetList {
  id: string;
  name: string;
  items: SetItem[];
  version: string;
}

export const MAX_SET_ITEMS = 500;
export const MAX_SET_NAME_LENGTH = 100;
const MAX_ID_LENGTH = 64;
const MAX_STEP_NAME_LENGTH = 200;
const MAX_STEP_INDEX = 10_000;

/**
 * A set name as it will be stored: trimmed, 1–100 characters. `null` when the name is refused
 * (not a string, empty after trimming, or too long), so the old name stays.
 */
export function validateSetName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_SET_NAME_LENGTH) return null;
  return trimmed;
}

const isShortId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

function sanitizeTransition(value: unknown): SetItemTransition | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { type, length } = value as { type?: unknown; length?: unknown };
  if (!(TRANSITION_TYPE_OPTIONS as readonly unknown[]).includes(type)) return undefined;
  if (!(TRANSITION_LENGTH_OPTIONS as readonly unknown[]).includes(length)) return undefined;
  return { type: type as TransitionType, length: length as TransitionLength };
}

function sanitizeItem(value: unknown): SetItem | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isShortId(raw.id) || !isShortId(raw.trackId)) return null;
  const transition = sanitizeTransition(raw.transition);
  if (transition === undefined) return null;

  const item: SetItem = { id: raw.id, trackId: raw.trackId, transition };
  if (raw.stepId !== undefined) {
    if (!isShortId(raw.stepId)) return null;
    item.stepId = raw.stepId;
  }
  if (raw.stepName !== undefined) {
    if (typeof raw.stepName !== 'string' || raw.stepName.length > MAX_STEP_NAME_LENGTH) return null;
    item.stepName = raw.stepName;
  }
  if (raw.stepIndex !== undefined) {
    if (
      !Number.isInteger(raw.stepIndex) ||
      (raw.stepIndex as number) < 0 ||
      (raw.stepIndex as number) > MAX_STEP_INDEX
    ) {
      return null;
    }
    item.stepIndex = raw.stepIndex as number;
  }
  return item;
}

/**
 * The items of a set, keeping only the known fields of each. `null` when anything is wrong: not an
 * array, more than 500 items, an item without a valid `id` / `trackId`, an unknown transition type
 * or length, or two items with the same id. Unknown keys are dropped, not refused.
 */
export function sanitizeItems(value: unknown): SetItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_SET_ITEMS) return null;
  const items: SetItem[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const item = sanitizeItem(entry);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }
  return items;
}

/**
 * The first free "<base> N" (N = 1, 2, …) among `names`, e.g. "Set 3" when "Set 1" and "Set 2"
 * exist. `base` is the localized word for "Set".
 */
export function nextFreeSetName(base: string, names: Iterable<string>): string {
  const taken = new Set(names);
  for (let n = 1; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A row of `set_lists` → the wire shape. Items that no longer pass are dropped, never a 500. */
export function setFromRow(row: { id: string; name: string; items: unknown; updated_at: string }): SetList {
  const items = Array.isArray(row.items)
    ? row.items.map(sanitizeItem).filter((item): item is SetItem => item !== null)
    : [];
  return { id: row.id, name: row.name, items, version: row.updated_at };
}
