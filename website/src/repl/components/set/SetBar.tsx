/**
 * The set bar (spec 022 §2.3, tech §2.5): while a set plays, Now playing · Up next (or "End of
 * set"), one button that Cues or Goes (the same as Alt+Shift+N), and a menu with End set.
 * In the header after the scratch button; `touch` in the compact control bar. Logical classes only.
 */
import { useEffect, useRef, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import ForwardIcon from '@heroicons/react/24/outline/ForwardIcon';
import { useSetPlayerContext } from '../../sets/useSetPlayer';
import { itemTextById } from './setLabels';

/**
 * Touch (compact control bar): built like its siblings (Play, Update, Library, Settings), an icon
 * with a one-word caption under it (`setListCueShort` / `setListGoShort`, ≤ 7 characters), so it
 * never wraps or grows with a long translation. The full "Cue: <track>" is in aria-label/title.
 */
export const TOUCH_BUTTON_CLASSES =
  'min-h-11 min-w-11 shrink-0 px-1 flex flex-col items-center justify-center gap-0.5 rounded-lg';
/** The siblings' caption (CompactControlBar BarButton), kept on one line. */
export const TOUCH_CAPTION_CLASSES = 'text-[10px] leading-none opacity-70 first-letter:uppercase whitespace-nowrap';

/** Headphones (heroicons has none): Cue plays the next track on the headphones. */
function HeadphonesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      data-set-bar-icon="headphones"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 15.75v-3a8.25 8.25 0 0 1 16.5 0v3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 15.75a2.25 2.25 0 0 1 2.25-2.25h.75a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75H6a2.25 2.25 0 0 1-2.25-2.25v-1.5Zm16.5 0a2.25 2.25 0 0 0-2.25-2.25h-.75a.75.75 0 0 0-.75.75v4.5c0 .414.336.75.75.75H18a2.25 2.25 0 0 0 2.25-2.25v-1.5Z"
      />
    </svg>
  );
}

export function SetBar({ touch = false, className }: { touch?: boolean; className?: string }) {
  const ctx = useSetPlayerContext();
  const { t } = useTranslation('settings');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  if (!ctx || !ctx.enabled || !ctx.player.setId) return null;
  const set = ctx.sets.find((candidate) => candidate.id === ctx.player.setId);
  const now = itemTextById(t, set?.items, ctx.player.nowItemId, ctx.tracks);
  const next = ctx.endOfSet ? t('setListEndOfSet') : itemTextById(t, set?.items, ctx.player.nextItemId, ctx.tracks);
  const mode = ctx.buttonMode;
  const busy = ctx.player.phase === 'cueing' || ctx.player.phase === 'going';
  const label = mode === 'go' ? t('setListGo') : t('setListCue');

  return (
    <div
      data-set-bar=""
      data-set-bar-touch={touch ? 'true' : 'false'}
      className={cx('relative flex items-center gap-1', touch ? 'shrink-0' : 'min-w-0', className)}
    >
      {!touch && (
        <div className="hidden md:flex flex-col min-w-0 max-w-56 text-[10px] leading-tight text-foreground">
          <span className="truncate" data-set-bar-now="">
            <span className="opacity-60">{t('setListNow')}:</span> {now}
          </span>
          <span className="truncate" data-set-bar-next="">
            {ctx.endOfSet ? (
              <span className="opacity-80">{next}</span>
            ) : (
              <>
                <span className="opacity-60">{t('setListUpNext')}:</span> {next}
              </>
            )}
          </span>
        </div>
      )}
      <button
        type="button"
        data-set-bar-button={mode}
        onClick={() => ctx.press()}
        disabled={busy || (mode === 'cue' && ctx.endOfSet)}
        title={`${label}: ${next} (Alt+Shift+N)`}
        aria-label={`${label}: ${next}`}
        className={cx(
          'select-none transition-colors disabled:opacity-40',
          touch ? TOUCH_BUTTON_CLASSES : 'rounded-md font-semibold h-7 px-2 text-xs',
          mode === 'go' ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-blue-600/80 text-white hover:bg-blue-500',
          busy && 'animate-pulse',
        )}
      >
        {touch ? (
          <>
            {mode === 'go' ? (
              <ForwardIcon className="w-6 h-6" aria-hidden="true" data-set-bar-icon="forward" />
            ) : (
              <HeadphonesIcon className="w-6 h-6" />
            )}
            <span data-set-bar-caption="" className={TOUCH_CAPTION_CLASSES}>
              {mode === 'go' ? t('setListGoShort') : t('setListCueShort')}
            </span>
          </>
        ) : (
          label
        )}
      </button>
      {/* Desktop only. In the compact bar the set bar is the one Cue/Go button: End set lives in
          the title bar's More menu (CompactMoreMenu), so the transition picker keeps its width. */}
      {!touch && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            data-set-bar-menu=""
            aria-label={t('setListMenu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md text-foreground hover:bg-lineHighlight h-7 px-1 text-xs"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute z-50 end-0 top-full mt-1 min-w-40 rounded-md border border-lineHighlight bg-background shadow-lg p-1"
            >
              <button
                type="button"
                role="menuitem"
                data-set-bar-end=""
                className="w-full text-start px-2 py-1 text-sm rounded hover:bg-lineHighlight text-foreground"
                onClick={() => {
                  setMenuOpen(false);
                  ctx.endSet();
                }}
              >
                {t('setListEnd')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
