import { useCallback, useEffect, useRef, useState } from 'react';
import { EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { formatElapsedTime } from '../../recording/formatUtils';
import { activeRecordingSeconds, isAnyRecording } from '../recordActions';
import { CompactMoreMenu, type MoreMenuContext } from './CompactMoreMenu';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export interface TitleBarContext extends MoreMenuContext {
  pending?: boolean;
}

/**
 * Compact screens (spec 016 2.1): a thin 44px bar with the logo, the open track's name and the
 * "More" menu. Logical (start/end) classes, so Hebrew and Arabic mirror it.
 */
export function CompactTitleBar({ context, trackName }: { context: TitleBarContext; trackName?: string }) {
  const { t } = useTranslation(['common', 'files']);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const recording = isAnyRecording(context);

  // Same as the desktop popover: the menu closes when a recording ends.
  useEffect(() => {
    if (!recording) setMenuOpen(false);
  }, [recording]);

  return (
    <header
      data-compact-title-bar=""
      // Safe area (spec 016 review #5): below the notch / status bar; the REPL column pads left and
      // right. The divider is an inset shadow, not a border, so the 44px More button fits the bar.
      className="relative z-20 shrink-0 pt-[env(safe-area-inset-top)] select-none bg-background shadow-[inset_0_-1px_0_0_var(--lineHighlight)]"
    >
      <div className="flex items-center h-11 ps-3 pe-0 gap-2" data-compact-title-row="">
        <a
          href={`${baseNoTrailing}/`}
          title="Strudel home"
          className={cx('text-lg leading-none text-foreground', context.pending && 'animate-spin')}
        >
          ꩜
        </a>
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground" data-compact-track-name="">
          {trackName || t('files:untitled')}
        </span>
        {recording && (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-red-400 tabular-nums">
            <span className="w-2 h-2 rounded-full bg-red-500 recording-pulse" />
            {formatElapsedTime(activeRecordingSeconds(context))}
          </span>
        )}
        <div className="relative">
          <button
            ref={moreRef}
            type="button"
            data-compact-more=""
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('common:more')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="h-11 w-11 flex items-center justify-center text-foreground active:bg-lineHighlight"
          >
            <EllipsisVerticalIcon className="w-6 h-6" />
          </button>
          <CompactMoreMenu context={context} open={menuOpen} onClose={closeMenu} anchorRef={moreRef} />
        </div>
      </div>
    </header>
  );
}
