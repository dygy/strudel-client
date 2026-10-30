import { useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { isRTL } from '@src/i18n/languageConfig';

/** A swipe of more than this many px towards the drawer's edge closes it. */
export const SWIPE_CLOSE_DISTANCE = 60;

/**
 * Whether a pointer gesture is a swipe back towards the drawer's edge: mostly horizontal, longer
 * than SWIPE_CLOSE_DISTANCE, and towards the start edge (left, or right in RTL). A vertical
 * scroll of the track tree never qualifies.
 */
export function isSwipeToClose(dx: number, dy: number, rtl: boolean): boolean {
  if (Math.abs(dx) <= Math.abs(dy)) return false;
  return rtl ? dx > SWIPE_CLOSE_DISTANCE : dx < -SWIPE_CLOSE_DISTANCE;
}

/**
 * Compact screens (spec 016 2.2): the track library as an overlay drawer over the code, from the
 * start edge (left; right in Hebrew and Arabic). Closed, it slides out and is hidden, but its
 * children stay mounted, so the tree keeps its open folders and the library's save paths never
 * unmount. Closes via the close button, a tap on the backdrop, or a swipe towards its edge.
 */
export function LibraryDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t, i18n } = useTranslation('common');
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from || from.id !== e.pointerId) return;
    if (isSwipeToClose(e.clientX - from.x, e.clientY - from.y, isRTL(i18n.language))) onClose();
  };

  return (
    <>
      <div
        data-library-backdrop=""
        aria-hidden="true"
        onClick={onClose}
        className={cx(
          'absolute inset-0 z-[14] bg-black/40 transition-opacity duration-200 motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />
      <aside
        data-library-drawer=""
        data-open={open ? 'true' : 'false'}
        aria-label={t('library')}
        aria-hidden={!open}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (start.current = null)}
        className={cx(
          // pan-y on every descendant too: touch-action only intersects up to the nearest scroll
          // container, so the tree's own scroller would otherwise take the horizontal swipe
          // (the browser sends pointercancel and the swipe never reaches pointerup).
          'touch-pan-y [&_*]:touch-pan-y',
          'absolute inset-y-0 start-0 z-[15] w-[min(85vw,360px)] flex flex-col',
          'bg-background border-e border-lineHighlight shadow-[0_0_32px_rgba(0,0,0,0.6)]',
          'transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none',
          open ? 'translate-x-0 visible' : '-translate-x-full rtl:translate-x-full invisible',
        )}
      >
        <div className="flex items-center shrink-0 h-11 ps-3 border-b border-lineHighlight">
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{t('library')}</span>
          <button
            type="button"
            data-library-close=""
            onClick={onClose}
            aria-label={t('closeLibrary')}
            className="h-11 w-11 flex items-center justify-center text-foreground active:bg-lineHighlight"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="relative flex-1 min-h-0 overflow-hidden">{children}</div>
      </aside>
    </>
  );
}
