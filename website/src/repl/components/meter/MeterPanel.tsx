/**
 * Settings → Meter (spec 033 functional §2.6, tech §2.4): the on/off switch, the readings (M, S, I large,
 * TP, LRA), the left/right peak and RMS bars, the 60 s history, the target, the warning light with the
 * counts by reason, and Reset. Off removes the readings (and the strips); the spec 030 peak bars are
 * their own feature and stay.
 *
 * Numbers and the history's time axis stay left-to-right in RTL languages; the rest mirrors.
 */
import type { ReactNode } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { loudnessRuntime, LOUDNESS_REASONS, type LoudnessRuntime } from '../../meter/loudnessRuntime';
import { useLoudnessSettings, useLoudnessView } from '../../meter/useLoudness';
import { LEVEL_BAR_RANGE, formatReading, reasonLabel, shortTermTone, toPercent } from '../../meter/loudnessFormat';
import { LOUDNESS_TARGETS, type LoudnessTarget } from '../../meter/meterSettings';
import { LoudnessHistory } from './LoudnessHistory';
import { WarningLight } from './WarningLight';

const TARGET_LABELS: Record<LoudnessTarget, string> = {
  [-14]: 'meter.targetStreaming',
  [-23]: 'meter.targetBroadcast',
  [-9]: 'meter.targetClub',
};
const TARGET_OFF = 'off';

function Reading({
  id,
  label,
  value,
  unit,
  large,
  tone,
}: {
  id: string;
  label: string;
  value: string;
  unit: string;
  large?: boolean;
  tone?: string;
}) {
  return (
    <div className="min-w-0 flex flex-col justify-between gap-0.5" data-meter-reading={id}>
      {/* The full label wraps (its qualifier, e.g. "400 ms", is part of the meaning); the value lines up below. */}
      <div className="text-xs leading-tight break-words text-foreground opacity-60" data-meter-label={id}>
        {label}
      </div>
      <bdi dir="ltr" className="flex items-baseline gap-1 font-mono tabular-nums text-foreground">
        <span
          className={cx(
            large ? 'text-3xl font-semibold' : 'text-lg',
            tone === 'loud' && 'text-amber-400',
            tone === 'quiet' && 'opacity-50',
          )}
          data-meter-value={id}
        >
          {value}
        </span>
        <span className="text-xs opacity-60">{unit}</span>
      </bdi>
    </div>
  );
}

function LevelRow({
  channel,
  peak,
  rms,
  language,
}: {
  channel: 'L' | 'R';
  peak: number | null;
  rms: number | null;
  language?: string;
}) {
  const peakAt = toPercent(peak, LEVEL_BAR_RANGE);
  return (
    <div className="flex items-center gap-2" data-meter-level={channel}>
      <span className="w-3 text-xs font-mono text-foreground opacity-60">{channel}</span>
      <div className="relative flex-1 h-2 rounded-sm bg-lineHighlight overflow-hidden">
        <div
          className="absolute inset-y-0 bg-green-600"
          style={{ insetInlineStart: 0, width: `${toPercent(rms, LEVEL_BAR_RANGE)}%` }}
          data-meter-rms-fill=""
        />
        {peakAt > 0 && (
          <div
            className={cx('absolute inset-y-0 w-0.5', peak !== null && peak >= -1 ? 'bg-red-400' : 'bg-foreground')}
            style={{ insetInlineStart: `calc(${peakAt}% - 1px)` }}
            data-meter-peak-mark=""
          />
        )}
      </div>
      <bdi
        dir="ltr"
        className="w-36 shrink-0 whitespace-nowrap text-end text-xs font-mono tabular-nums text-foreground"
      >
        {formatReading(peak, language)} / {formatReading(rms, language)} dBFS
      </bdi>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-foreground opacity-60">{label}</div>
      {children}
    </div>
  );
}

export function MeterPanel({ runtime = loudnessRuntime }: { runtime?: LoudnessRuntime }) {
  const { t, i18n } = useTranslation('settings');
  const language = i18n?.language;
  const settings = useLoudnessSettings(runtime);
  const view = useLoudnessView(runtime);
  const snapshot = view.snapshot;
  const fmt = (value: number | null | undefined) => formatReading(value, language);
  const targetLabel = (target: LoudnessTarget) =>
    `${new Intl.NumberFormat(language || undefined).format(target)} LUFS — ${t(TARGET_LABELS[target])}`;

  return (
    <section data-meter-panel="" aria-label={t('meter.title')} className="space-y-4">
      <p className="text-sm text-foreground opacity-70">{t('meter.description')}</p>

      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          data-meter-on=""
          checked={settings.on}
          onChange={(event) => runtime.setOn(event.target.checked)}
          className="w-4 h-4 accent-green-500 cursor-pointer"
        />
        <span>{t('meter.on')}</span>
      </label>

      {!settings.on ? (
        <p className="text-sm text-foreground opacity-60" data-meter-off-note="">
          {t('meter.offNote')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3" data-meter-readings="">
            <Reading id="m" label={t('meter.momentary')} value={fmt(snapshot?.m)} unit="LUFS" />
            <Reading
              id="s"
              label={t('meter.shortTerm')}
              value={fmt(snapshot?.s)}
              unit="LUFS"
              tone={shortTermTone(snapshot?.s, settings.target)}
            />
            <Reading id="i" label={t('meter.integrated')} value={fmt(snapshot?.i)} unit="LUFS" large />
            <Reading id="tp" label={t('meter.truePeak')} value={fmt(snapshot?.tpMax)} unit="dBTP" />
            <Reading id="lra" label={t('meter.range')} value={fmt(snapshot?.lra)} unit="LU" />
          </div>

          <Row label={t('meter.peakRms')}>
            <LevelRow
              channel="L"
              peak={snapshot?.peakDb?.[0] ?? null}
              rms={snapshot?.rmsDb?.[0] ?? null}
              language={language}
            />
            <LevelRow
              channel="R"
              peak={snapshot?.peakDb?.[1] ?? null}
              rms={snapshot?.rmsDb?.[1] ?? null}
              language={language}
            />
          </Row>

          <LoudnessHistory runtime={runtime} target={settings.target} />

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1 min-w-0">
              <label htmlFor="loudness-meter-target" className="block text-sm text-foreground">
                {t('meter.target')}
              </label>
              <select
                id="loudness-meter-target"
                data-meter-target=""
                value={settings.target === null ? TARGET_OFF : String(settings.target)}
                onChange={(event) => {
                  const raw = event.target.value;
                  runtime.setTarget(raw === TARGET_OFF ? null : (Number(raw) as LoudnessTarget));
                }}
                className="px-3 py-2 bg-background border border-lineHighlight rounded-lg text-sm text-foreground"
              >
                {LOUDNESS_TARGETS.map((target) => (
                  <option key={target} value={String(target)}>
                    {targetLabel(target)}
                  </option>
                ))}
                <option value={TARGET_OFF}>{t('meter.targetOff')}</option>
              </select>
            </div>
            <button
              type="button"
              data-meter-reset=""
              onClick={() => runtime.reset()}
              title={t('meter.resetHint')}
              className="px-3 py-2 rounded-lg border border-lineHighlight text-sm text-foreground hover:bg-lineHighlight"
            >
              {t('meter.reset')}
            </button>
          </div>

          <Row label={t('meter.warnings')}>
            <div className="flex flex-wrap items-center gap-3">
              <WarningLight warning={view.warning} events={snapshot?.events} onClear={() => runtime.clearWarning()} />
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground" data-meter-counts="">
                {LOUDNESS_REASONS.map((reason) => (
                  <li key={reason} data-meter-count={reason}>
                    <bdi>{reasonLabel(t, reason)}</bdi>:{' '}
                    <bdi dir="ltr" className="font-mono tabular-nums">
                      {snapshot?.events?.[reason] ?? 0}
                    </bdi>
                  </li>
                ))}
              </ul>
            </div>
          </Row>
        </>
      )}
    </section>
  );
}
