/**
 * Where the playing set is, per browser (spec 022 §2.3 "After a reload", tech §2.3): localStorage
 * `strudel-set-position` = `{ setId, nowItemId, nextItemId }`. Written on every landed Cue or Go,
 * select and end; read on load. Nothing cued is kept, because nothing plays after a reload.
 *
 * Storage can throw (private mode, quota, disabled): every access is wrapped, and a value that
 * isn't the expected shape counts as no position.
 */
export const SET_POSITION_KEY = 'strudel-set-position';

export interface SetPosition {
  setId: string;
  nowItemId: string | null;
  nextItemId: string | null;
}

type PositionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): PositionStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const isIdOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0);

/** The saved position, or null when there is none, it is damaged, or storage is unavailable. */
export function readSetPosition(storage: PositionStorage | null = defaultStorage()): SetPosition | null {
  try {
    const raw = storage?.getItem(SET_POSITION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { setId, nowItemId, nextItemId } = value as Record<string, unknown>;
    if (typeof setId !== 'string' || !setId || !isIdOrNull(nowItemId) || !isIdOrNull(nextItemId)) return null;
    return { setId, nowItemId, nextItemId };
  } catch (error: unknown) {
    console.warn('[sets] could not read the set position:', error);
    return null;
  }
}

/** Save the position (null = no set playing: the key is removed). Never throws. */
export function writeSetPosition(
  position: SetPosition | null,
  storage: PositionStorage | null = defaultStorage(),
): void {
  try {
    if (!storage) return;
    if (position === null) {
      storage.removeItem(SET_POSITION_KEY);
    } else {
      const { setId, nowItemId, nextItemId } = position;
      storage.setItem(SET_POSITION_KEY, JSON.stringify({ setId, nowItemId, nextItemId }));
    }
  } catch (error: unknown) {
    console.warn('[sets] could not save the set position:', error);
  }
}
