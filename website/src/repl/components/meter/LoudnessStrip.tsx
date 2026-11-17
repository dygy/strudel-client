/**
 * The compact loudness strip (spec 033 functional §2.5, tech §2.4), in the desktop header and in the
 * performance view: the Short-term value, a thin −36…0 LUFS bar with a mark at the target, and the
 * latching warning light. The number opens Settings → Meter. Not shown while the meter is off.
 *
 * The Short-term colour: amber above target + 2 LU, dimmed below target − 6 LU, otherwise neutral.
 * Numbers stay left-to-right in RTL languages; the bar fills from the inline start like spec 030's.
 */
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { usePanelViewport } from '../panel/panelViewport';
import { loudnessRuntime, type LoudnessRuntime } from '../../meter/loudnessRuntime';
import { useLoudnessSettings, useLoudnessView } from '../../meter/useLoudness';
import { STRIP_BAR_RANGE, formatReading, shortTermTone, toPercent } from '../../meter/loudnessFormat';
import { openMeterPanel } from '../../meter/openMeterPanel';
import { WarningLight } from './WarningLight';

export function LoudnessStrip({
  runtime = loudnessRuntime,
  variant,
  onOpen,
  className,
}: {
  runtime?: LoudnessRuntime;
  variant: 'header' | 'performance';
  /** Replaces opening Settings → Meter (tests). */
  onOpen?: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation('settings');
  const settings = useLoudnessSettings(runtime);
  const view = useLoudnessView(runtime);
  const { compact } = usePanelViewport();
  if (!settings.on) return null;

  const shortTerm = view.snapshot?.s ?? null;
  const tone = shortTermTone(shortTerm, settings.target);
  const value = formatReading(shortTerm, i18n?.language);
  const fill = toPercent(shortTerm, STRIP_BAR_RANGE);
  const targetAt = settings.target === null ? null : toPercent(settings.target, STRIP_BAR_RANGE);
  const label = `${t('meter.shortTerm')}: ${value} LUFS`;

  return (
    <div
      data-loudness-strip={variant}
      role="group"
      aria-label={t('meter.strip')}
      className={cx('flex items-center gap-1.5 shrink-0', className)}
    >
      <button
        type="button"
        data-loudness-open=""
        onClick={() => (onOpen ? onOpen() : openMeterPanel({ compact }))}
        title={`${label} — ${t('meter.open')}`}
        aria-label={`${label}. ${t('meter.open')}`}
        className="flex items-center gap-1.5 h-7 rounded-md px-1.5 hover:bg-lineHighlight cursor-pointer"
      >
        <bdi dir="ltr" className="flex items-baseline gap-1 font-mono tabular-nums leading-none">
          <span className="text-[10px] text-foreground opacity-50">S</span>
          <span
            data-loudness-short-term={tone}
            className={cx(
              'text-xs w-10 text-end',
              tone === 'loud' && 'text-amber-400 font-semibold',
              tone === 'quiet' && 'text-foreground opacity-40',
              tone === 'neutral' && 'text-foreground',
            )}
          >
            {value}
          </span>
        </bdi>
        <span
          className={cx(
            'relative h-1.5 rounded-sm bg-lineHighlight overflow-hidden',
            variant === 'header' ? 'w-10' : 'w-16',
          )}
          data-loudness-bar=""
          aria-hidden="true"
        >
          <span
            className={cx('absolute inset-y-0', tone === 'loud' ? 'bg-amber-400' : 'bg-green-500')}
            style={{ insetInlineStart: 0, width: `${fill}%` }}
          />
          {targetAt !== null && (
            <span
              className="absolute inset-y-0 w-0.5 bg-foreground"
              style={{ insetInlineStart: `calc(${targetAt}% - 1px)` }}
              data-loudness-target-mark=""
            />
          )}
        </span>
      </button>
      <WarningLight warning={view.warning} events={view.snapshot?.events} onClear={() => runtime.clearWarning()} />
    </div>
  );
}
