import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { Platter } from './Platter';
import { DeckSwitch, isScratchActive, platterStatusKey } from './ScratchSection';
import { scratchRuntime, selectedSpin, type ScratchRuntime } from '../../scratch/scratchRuntime';

/** A small record, for the button. */
function RecordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" strokeOpacity={0.5} />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The Scratch button in the header and in the compact control bar (spec 019 2.1). It opens a
 * floating platter next to it, the same control as the one in Mixer Settings (same runtime, same
 * deck choice). An outside click or Escape closes it. `touch` (spec 016's compact bar): a 44px
 * button whose popover opens above the bar, centred, with a finger-sized platter.
 */
export function ScratchButton({
  touch = false,
  className,
  runtime = scratchRuntime,
}: {
  touch?: boolean;
  className?: string;
  runtime?: ScratchRuntime;
}) {
  const { t } = useTranslation('settings');
  const state = useStore(runtime.store);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const statusKey = platterStatusKey(state);
  const label = t('scratch');

  return (
    // In the compact bar the popover is placed against the bar (the nearest positioned parent),
    // centred above it; in the header it hangs below the button, aligned to its end edge.
    <div className={cx(!touch && 'relative', className)} data-scratch-button-root="">
      <button
        ref={buttonRef}
        type="button"
        data-scratch-button={touch ? 'touch' : 'header'}
        aria-label={t('scratchOpen')}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('scratchOpen')}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'flex items-center justify-center rounded-md select-none text-foreground transition-colors duration-150',
          touch
            ? 'min-h-11 min-w-11 max-w-24 flex-col gap-0.5 rounded-lg active:bg-lineHighlight'
            : 'w-7 h-7 hover:bg-lineHighlight',
          (open || state.grabbed) && 'bg-orange-400 bg-opacity-10 shadow-[0_0_10px_rgba(251,146,60,0.45)]',
        )}
      >
        <RecordIcon className={cx(touch ? 'w-6 h-6' : 'w-4 h-4', 'opacity-80')} />
        {touch && <span className="text-[10px] leading-none opacity-70 first-letter:uppercase">{label}</span>}
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={label}
          data-scratch-popover={touch ? 'touch' : 'header'}
          className={cx(
            'absolute z-[100] p-3 space-y-2 rounded-lg bg-background border border-lineHighlight',
            'shadow-[0_8px_32px_rgba(0,0,0,0.6)] animate-[popoverIn_0.18s_ease-out]',
            touch ? 'inset-x-0 bottom-full mb-2 mx-auto w-max' : 'end-0 top-full mt-2 min-w-[15rem]',
          )}
        >
          <div className="flex justify-center">
            <Platter
              actions={runtime}
              active={isScratchActive(state)}
              grabbed={state.grabbed}
              size={touch ? 'compact' : 'settings'}
              label={t('scratchPlatter')}
              spin={selectedSpin(state)}
            />
          </div>
          <p
            data-scratch-status=""
            className="text-xs text-foreground opacity-70 text-center max-w-[14rem] mx-auto min-h-[1rem]"
            aria-live="polite"
          >
            {statusKey ? t(statusKey) : ''}
          </p>
          <div className="flex justify-center">
            <DeckSwitch runtime={runtime} state={state} withPreview touch={touch} />
          </div>
        </div>
      )}
    </div>
  );
}
