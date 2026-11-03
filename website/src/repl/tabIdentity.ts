/**
 * Which tab this is, for telling a tab's own drafts from another's. The id lives in sessionStorage, so
 * it survives a reload. A Web Lock held for the page's life lets other tabs ask whether it's still
 * open, and catches a duplicated tab, whose sessionStorage (and so its id) is a copy of a live tab's.
 */
import { nanoid } from 'nanoid';

const TAB_ID_KEY = 'strudel-tab-id';
const lockName = (tabId: string) => `strudel-tab:${tabId}`;
/** A reloading page's lock may outlast it briefly, so a taken lock gets one more try. */
const RELOAD_GRACE_MS = 300;

type Locks = Pick<LockManager, 'request' | 'query'>;
const browserLocks = (): Locks | null => (typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null);

/** Holds the lock for this id if nobody has it. Returns how to let go, or null if it's taken. */
function tryHold(locks: Locks, tabId: string): Promise<(() => void) | null> {
  return new Promise((resolve) => {
    locks
      .request(lockName(tabId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(() => resolve(() => {}));
  });
}

/** Claims this tab's id for the page's life. */
export async function claimTab(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  locks: Locks | null = browserLocks(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ tabId: string; release: () => void }> {
  const fresh = () => {
    const created = nanoid();
    try {
      storage?.setItem(TAB_ID_KEY, created);
    } catch {
      // Without storage the id lasts for this page only, and a reload is treated as another tab.
    }
    return created;
  };
  let known: string | null = null;
  try {
    known = storage?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    // As above.
  }
  const tabId = known ?? fresh();
  if (!locks) return { tabId, release: () => {} };

  let release = await tryHold(locks, tabId);
  if (!release && known) {
    await sleep(RELOAD_GRACE_MS);
    release = await tryHold(locks, tabId);
  }
  if (release) return { tabId, release };
  // A live page holds this id: this tab is a copy of it.
  const ownId = fresh();
  return { tabId: ownId, release: (await tryHold(locks, ownId)) ?? (() => {}) };
}

/**
 * Without the Locks API a tab can't tell, and answers no: the worst outcome is a notice offering a draft
 * that its own tab still has, never a draft adopted or lost.
 */
export async function isTabAlive(tabId: string, locks: Locks | null = browserLocks()): Promise<boolean> {
  if (!locks) return false;
  try {
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === lockName(tabId));
  } catch {
    return false;
  }
}
