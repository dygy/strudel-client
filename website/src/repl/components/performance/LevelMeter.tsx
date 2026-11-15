/**
 * The master level meter (spec 030 §2.4, tech §2.6): two bars (left, right) of the main output as
 * heard on the speakers, a peak marker that holds, the top 1 dB in red, and a clip light.
 *
 * The tap (levelMeter.ts) is opened on mount and closed on unmount, so it exists only while the
 * performance strip is shown. A requestAnimationFrame loop reads it; while the tab is hidden the
 * loop skips the read and draws nothing.
 */
import { useEffect, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { getAudioContext } from '@strudel/webaudio';
import {
  METER_FLOOR_DB,
  meterBallistics,
  openLevelMeter,
  type LevelMeterTap,
  type MeterDisplay,
} from '../../performance/levelMeter';

/** The red zone: the top 1 dB of the scale. */
export const METER_RED_DB = -1;

/** A dB value as a percentage of the bar (the floor is 0 %, 0 dBFS is 100 %). */
export function dbToPercent(db: number): number {
  if (!Number.isFinite(db)) return db > 0 ? 100 : 0;
  const pct = ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
  return Math.min(100, Math.max(0, pct));
}

const RED_START = dbToPercent(METER_RED_DB);

const SILENT: MeterDisplay = {
  peakDb: [-Infinity, -Infinity],
  holdDb: [-Infinity, -Infinity],
  holdAgeMs: [0, 0],
  clip: false,
  clipAgeMs: Infinity,
};

function Bar({ peakDb, holdDb, channel }: { peakDb: number; holdDb: number; channel: 'L' | 'R' }) {
  const pct = dbToPercent(peakDb);
  const hold = dbToPercent(holdDb);
  return (
    <div className="relative h-1.5 w-full rounded-sm bg-lineHighlight overflow-hidden" data-meter-bar={channel}>
      <div
        className="absolute inset-y-0 bg-green-500"
        style={{ insetInlineStart: 0, width: `${Math.min(pct, RED_START)}%` }}
        data-meter-fill=""
      />
      {pct > RED_START && (
        <div
          className="absolute inset-y-0 bg-red-500"
          style={{ insetInlineStart: `${RED_START}%`, width: `${pct - RED_START}%` }}
          data-meter-red=""
        />
      )}
      {hold > 0 && (
        <div
          className={cx('absolute inset-y-0 w-0.5', hold > RED_START ? 'bg-red-300' : 'bg-foreground')}
          style={{ insetInlineStart: `calc(${hold}% - 1px)` }}
          data-meter-hold=""
        />
      )}
    </div>
  );
}

export function LevelMeter({ className }: { className?: string }) {
  const { t } = useTranslation('settings');
  const [display, setDisplay] = useState<MeterDisplay>(SILENT);

  useEffect(() => {
    let tap: LevelMeterTap | null = null;
    try {
      tap = openLevelMeter(getAudioContext());
    } catch (error: unknown) {
      // No audio context yet (audio never started): the meter shows silence.
      console.warn('[performance] level meter unavailable', error);
    }
    let raf = 0;
    let last: number | null = null;
    let prev: MeterDisplay | null = null;
    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !tap) {
        last = time;
        return;
      }
      const dt = last === null ? 0 : Math.max(0, time - last);
      last = time;
      prev = meterBallistics(prev, tap.read(), dt);
      setDisplay(prev);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      tap?.close();
    };
  }, []);

  const louder = Math.max(display.peakDb[0], display.peakDb[1]);
  const valueNow = Number.isFinite(louder) ? Math.round(louder * 10) / 10 : METER_FLOOR_DB;

  return (
    <div className={cx('flex items-center gap-2 shrink-0', className)} data-perf-meter="">
      <div
        role="meter"
        aria-label={t('performLevel')}
        aria-valuemin={METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={valueNow}
        className="flex flex-col gap-1 w-28"
      >
        <Bar channel="L" peakDb={display.peakDb[0]} holdDb={display.holdDb[0]} />
        <Bar channel="R" peakDb={display.peakDb[1]} holdDb={display.holdDb[1]} />
      </div>
      <span
        data-meter-clip={display.clip ? 'on' : 'off'}
        title={t('performClip')}
        className={cx(
          'rounded px-1 text-[10px] font-semibold leading-4 uppercase',
          display.clip ? 'bg-red-600 text-white' : 'bg-lineHighlight text-foreground opacity-50',
        )}
      >
        {t('performClip')}
      </span>
    </div>
  );
}
