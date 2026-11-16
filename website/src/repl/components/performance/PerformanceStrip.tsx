/**
 * The performance view's strip (spec 030 §2.2, tech §2.3): Play/Stop and Update (the header's own
 * buttons), Now / Next with Cue/Go (the set bar's model, useSetBarModel), the clocks, the level
 * meter, A− / A+ for the code's size in this view, and Exit.
 *
 * One row that wraps on a narrow screen (flex-wrap, nothing wider than the window), with logical
 * spacing only so an RTL language mirrors it. Mounted by ReplEditor only while the view is open: it
 * owns the meter's tap, the clock display and its buttons, nothing else. Spec 031 adds a compact
 * crossfader (the Mixer settings' one, same state).
 */
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { PlayButton, UpdateButton, type ReplContext } from '../Header';
import { useSetBarModel } from '../set/useSetBarModel';
import { PerformanceClocks } from './PerformanceClocks';
import { LevelMeter } from './LevelMeter';
import { CrossfaderControl } from '../panel/MixerLevels';
import {
  closePerformance,
  clampPerformanceFontSize,
  performanceFontSize,
  PERFORMANCE_FONT_MAX,
  PERFORMANCE_FONT_MIN,
  stepPerformanceFontSize,
} from '../../performance/performanceStore';

const STRIP_BUTTON =
  'h-8 min-w-8 px-2 rounded-md text-sm text-foreground select-none hover:bg-lineHighlight disabled:opacity-30 disabled:cursor-not-allowed';

function NowNext({ trackName }: { trackName?: string }) {
  const { t } = useTranslation('settings');
  const model = useSetBarModel();
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 basis-48" data-perf-now-next="">
      <div className="flex flex-col min-w-0 text-foreground">
        <span className="truncate text-base leading-tight" data-perf-now="">
          <span className="opacity-60 text-xs">{t('setListNow')}:</span> {model ? model.now : trackName || '—'}
        </span>
        {model && (
          <span className="truncate text-xs leading-tight" data-perf-next="">
            {model.endOfSet ? (
              <span className="opacity-80">{model.next}</span>
            ) : (
              <>
                <span className="opacity-60">{t('setListUpNext')}:</span> {model.next}
              </>
            )}
          </span>
        )}
      </div>
      {model && (
        <button
          type="button"
          data-perf-cue-go={model.mode}
          onClick={model.press}
          disabled={model.disabled}
          title={`${model.label}: ${model.next} (Alt+Shift+N)`}
          aria-label={`${model.label}: ${model.next}`}
          className={cx(
            'shrink-0 rounded-md font-semibold h-8 px-3 text-sm text-white select-none transition-colors disabled:opacity-40',
            model.mode === 'go' ? 'bg-green-600 hover:bg-green-500' : 'bg-blue-600/80 hover:bg-blue-500',
            model.busy && 'animate-pulse',
          )}
        >
          {model.label}
        </button>
      )}
    </div>
  );
}

export function PerformanceStrip({ context, trackName }: { context: ReplContext; trackName?: string }) {
  const { t } = useTranslation('settings');
  const size = clampPerformanceFontSize(useStore(performanceFontSize));

  return (
    <div
      data-performance-strip=""
      role="toolbar"
      aria-label={t('performMode')}
      className={cx(
        'relative z-20 flex flex-wrap items-center gap-x-3 gap-y-1 ps-3 pe-3 py-1 min-w-0 max-w-full select-none',
        'bg-background border-b border-lineHighlight',
      )}
    >
      <div className="flex items-center gap-1 shrink-0">
        <PlayButton context={context} className="!w-8 !h-8" />
        <UpdateButton context={context} className="!w-8 !h-8" />
      </div>
      <NowNext trackName={trackName} />
      <CrossfaderControl strip />
      <PerformanceClocks />
      <LevelMeter />
      <div className="flex items-center gap-1 shrink-0" data-perf-font="">
        <button
          type="button"
          data-perf-smaller=""
          className={STRIP_BUTTON}
          onClick={() => stepPerformanceFontSize(-1)}
          disabled={size <= PERFORMANCE_FONT_MIN}
          aria-label={t('performSmallerCode')}
          title={t('performSmallerCode')}
        >
          <bdi dir="ltr">A−</bdi>
        </button>
        <span className="text-xs font-mono tabular-nums opacity-60 text-foreground" data-perf-font-size="">
          {size}
        </span>
        <button
          type="button"
          data-perf-bigger=""
          className={STRIP_BUTTON}
          onClick={() => stepPerformanceFontSize(1)}
          disabled={size >= PERFORMANCE_FONT_MAX}
          aria-label={t('performBiggerCode')}
          title={t('performBiggerCode')}
        >
          <bdi dir="ltr">A+</bdi>
        </button>
      </div>
      <button
        type="button"
        data-perf-exit=""
        onClick={closePerformance}
        title={`${t('performExit')} (Alt+Shift+P)`}
        className={cx(STRIP_BUTTON, 'ms-auto border border-lineHighlight')}
      >
        {t('performExit')}
      </button>
    </div>
  );
}
