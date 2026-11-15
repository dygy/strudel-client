/**
 * Set time and track time (spec 030 §2.3, tech §2.5). The numbers come from clockStore, which the
 * ticker in performanceClock.ts feeds whether or not the view is open. Clicking set time offers Reset.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { clockStore, formatClock, resetSetClock } from '../../performance/performanceClock';

export function PerformanceClocks({ className }: { className?: string }) {
  const { t } = useTranslation('settings');
  const { setMs, trackMs } = useStore(clockStore);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div data-perf-clocks="" className={cx('flex items-center gap-3 shrink-0', className)}>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          data-perf-set-time=""
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex flex-col items-start rounded-md px-2 py-0.5 hover:bg-lineHighlight text-foreground"
        >
          <span className="text-[10px] leading-none opacity-60">{t('performSetTime')}</span>
          <span className="text-lg leading-tight font-mono tabular-nums" data-perf-set-time-value="" dir="ltr">
            {formatClock(setMs)}
          </span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute z-50 start-0 top-full mt-1 min-w-32 rounded-md border border-lineHighlight bg-background shadow-lg p-1"
          >
            <button
              type="button"
              role="menuitem"
              data-perf-reset=""
              className="w-full text-start px-2 py-1 text-sm rounded hover:bg-lineHighlight text-foreground"
              onClick={() => {
                resetSetClock();
                setMenuOpen(false);
              }}
            >
              {t('performResetClock')}
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col items-start px-2 py-0.5 text-foreground" data-perf-track-time="">
        <span className="text-[10px] leading-none opacity-60">{t('performTrackTime')}</span>
        <span className="text-lg leading-tight font-mono tabular-nums" data-perf-track-time-value="" dir="ltr">
          {formatClock(trackMs)}
        </span>
      </div>
    </div>
  );
}
