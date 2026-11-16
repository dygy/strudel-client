/**
 * The Master FX filter knob (spec 032 §2.2, §2.8; tech §2.7): −100 (low-pass) … 0 (off) … +100
 * (high-pass), as a range input. Its row is always left-to-right, like the hardware knob and its MIDI
 * range (CC 0 = left = low-pass), also in Arabic and Hebrew (the 031 crossfader's rule).
 *
 * Double-click, or a double tap, centres it. It shows its side (LP / HP) and is plainly Off in the dead
 * zone. Every on-screen change tells the MIDI map, so a bound knob picks the position up again.
 */
import { useRef } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { masterFxRuntime, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';
import { filterSide } from '../../masterFx/masterFxSettings';
import { useMidiMapContext } from '../../midi/midiMapContext';
import { MIDI_TARGET_IDS } from '../../midi/midiTargetMeta';

const DOUBLE_TAP_MS = 300;

type T = (key: string, options?: Record<string, unknown>) => string;

/** The knob's reading: "Off", "Low-pass 40 %" or "High-pass 70 %". */
export function filterValueText(t: T, position: number): string {
  const side = filterSide(position);
  if (side === 'off') return t('masterFx.filterOff');
  const percent = Math.abs(Math.round(position));
  return t(side === 'lp' ? 'masterFx.filterLowPass' : 'masterFx.filterHighPass', { percent });
}

export function FilterKnob({
  runtime = masterFxRuntime,
  touch = false,
  strip = false,
}: {
  runtime?: Pick<MasterFxRuntime, 'filter' | 'setFilter'>;
  touch?: boolean;
  strip?: boolean;
}) {
  const { t } = useTranslation('settings');
  const midi = useMidiMapContext();
  const position = useStore(runtime.filter);
  const side = filterSide(position);
  const valueText = filterValueText(t, position);
  const lastTap = useRef(0);

  const set = (value: number) => {
    runtime.setFilter(value);
    midi?.notifyExternalChange(MIDI_TARGET_IDS.masterFilter);
  };

  const end = (which: 'lp' | 'hp') => (
    <span
      data-filter-end={which}
      data-active={side === which ? 'true' : undefined}
      className={cx(
        'shrink-0 inline-flex items-center justify-center rounded font-mono text-[10px] px-1 h-5 border',
        side === which
          ? 'border-orange-400 text-orange-300 font-bold'
          : 'border-lineHighlight text-foreground opacity-70',
      )}
    >
      {t(which === 'lp' ? 'masterFx.filterLp' : 'masterFx.filterHp')}
    </span>
  );

  return (
    <div
      className={cx('flex flex-col min-w-0', strip ? 'basis-32 shrink grow-0' : 'space-y-1')}
      data-master-fx-filter=""
      data-side={side}
    >
      {!strip && (
        <div className="flex items-center justify-between gap-2 text-sm text-foreground">
          <label htmlFor="master-fx-filter">{t('masterFx.filter')}</label>
          <span className="font-mono text-xs opacity-70 tabular-nums" data-master-fx-filter-value="">
            {valueText}
          </span>
        </div>
      )}
      <div dir="ltr" className="flex items-center gap-1 min-w-0" data-master-fx-filter-row="">
        {end('lp')}
        <input
          id={strip ? undefined : 'master-fx-filter'}
          type="range"
          dir="ltr"
          min={-100}
          max={100}
          step={1}
          value={position}
          aria-label={t('masterFx.filter')}
          aria-valuetext={valueText}
          title={strip ? `${t('masterFx.filter')}: ${valueText}` : t('masterFx.filterHint')}
          data-master-fx-filter-slider=""
          onChange={(event) => set(Number(event.target.value))}
          onDoubleClick={() => set(0)}
          onPointerDown={(event) => {
            // A double tap on a touch screen centres it, as a double-click does.
            if (event.pointerType !== 'touch') return;
            const now = event.timeStamp || Date.now();
            if (now - lastTap.current < DOUBLE_TAP_MS) set(0);
            lastTap.current = now;
          }}
          className={cx('flex-1 min-w-0 accent-foreground', touch && !strip && 'min-h-11')}
        />
        {end('hp')}
      </div>
      {strip && (
        <span className="text-[10px] leading-tight text-foreground opacity-70 truncate" data-master-fx-filter-value="">
          {valueText}
        </span>
      )}
    </div>
  );
}
