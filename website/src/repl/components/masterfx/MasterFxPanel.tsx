/**
 * Settings → Master FX (spec 032 §2.8, tech §2.7), after the Mixer settings: the filter knob and
 * resonance; Delay (time, feedback, level) and Reverb (decay, level), each with its hold button;
 * Beat-repeat with its length and hold button; Brake with its hold button and the note linking to the
 * scratch Brake / Spin-up sliders; All FX off.
 *
 * Settings are remembered in this browser (masterFxRuntime); the knob's position is not. Logical
 * spacing only, so Arabic and Hebrew mirror the layout; the knob's own row stays left-to-right.
 */
import type { ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { masterFxRuntime, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';
import {
  MASTER_FX_DELAY_FRACTIONS,
  MASTER_FX_RANGES,
  MASTER_FX_REPEAT_LENGTHS,
  fractionLabel,
} from '../../masterFx/masterFxSettings';
import { usePanelViewport } from '../panel/panelViewport';
import { FilterKnob } from './FilterKnob';
import { HoldButton } from './HoldButton';

/** Where the scratch section's Brake slider is (ScratchFeelControls' id). */
export const SCRATCH_BRAKE_SLIDER_ID = 'scratch-feel-brakeSeconds';

type Runtime = Pick<
  MasterFxRuntime,
  'settings' | 'filter' | 'held' | 'setSettings' | 'setFilter' | 'hold' | 'release' | 'allOff'
>;

const percent = (v01: number) => Math.round(v01 * 100);

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  text,
  onChange,
  touch,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (value: number) => void;
  touch: boolean;
}) {
  return (
    <div className="space-y-1 min-w-0" data-master-fx-setting={id}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`master-fx-${id}`} className="text-sm text-foreground">
          {label}
        </label>
        <output htmlFor={`master-fx-${id}`} className="text-xs text-foreground opacity-70 tabular-nums">
          <bdi>{text}</bdi>
        </output>
      </div>
      <input
        id={`master-fx-${id}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cx('w-full accent-foreground', touch && 'min-h-11')}
      />
    </div>
  );
}

/** A choice of cycle fractions (delay time, repeat length), shown as "3/16 cycle". */
export function FractionSelect({
  id,
  label,
  value,
  choices,
  onChange,
  touch = false,
  strip = false,
}: {
  id: string;
  label: string;
  value: number;
  choices: readonly number[];
  onChange: (value: number) => void;
  touch?: boolean;
  strip?: boolean;
}) {
  const { t } = useTranslation('settings');
  const select = (
    <select
      id={`master-fx-${id}`}
      aria-label={strip ? label : undefined}
      title={strip ? label : undefined}
      data-master-fx-select={id}
      value={String(choices.findIndex((choice) => Math.abs(choice - value) < 1e-9))}
      onChange={(event) => {
        const next = choices[Number(event.target.value)];
        if (next !== undefined) onChange(next);
      }}
      className={cx(
        'bg-background border border-lineHighlight rounded-md text-foreground cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-foreground',
        strip ? 'h-8 px-1 text-xs shrink-0' : cx('w-full px-3 text-sm', touch ? 'min-h-11' : 'h-8'),
      )}
    >
      {choices.map((choice, index) => (
        <option key={choice} value={String(index)} className="bg-background text-foreground">
          {strip ? fractionLabel(choice) : t('masterFx.cycle', { fraction: fractionLabel(choice) })}
        </option>
      ))}
    </select>
  );
  if (strip) return select;
  return (
    <div className="space-y-1 min-w-0" data-master-fx-setting={id}>
      <label htmlFor={`master-fx-${id}`} className="block text-sm text-foreground">
        {label}
      </label>
      {select}
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-3 border-t border-lineHighlight" data-master-fx-group={id}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground opacity-60">{title}</h4>
      {children}
    </div>
  );
}

/** Scroll to the scratch section's Brake slider and focus it (the two brakes are one). */
export function showScratchFeelSliders(): boolean {
  if (typeof document === 'undefined') return false;
  const slider = document.getElementById(SCRATCH_BRAKE_SLIDER_ID);
  if (!slider) return false;
  slider.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  slider.focus({ preventScroll: true });
  return true;
}

export function MasterFxPanel({ runtime = masterFxRuntime }: { runtime?: Runtime }) {
  const { t, i18n } = useTranslation('settings');
  const { compact: touch } = usePanelViewport();
  const settings = useStore(runtime.settings);
  const language = i18n?.language;
  const seconds = (value: number) =>
    t('masterFx.seconds', {
      value: new Intl.NumberFormat(language || undefined, { maximumFractionDigits: 1 }).format(value),
    });
  const { min: feedbackMin, max: feedbackMax } = MASTER_FX_RANGES.delayFeedback;
  const { min: decayMin, max: decayMax } = MASTER_FX_RANGES.reverbDecay;

  return (
    <section
      data-master-fx-panel=""
      aria-label={t('masterFx.title')}
      className="p-4 bg-background border border-lineHighlight rounded-lg space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{t('masterFx.title')}</h3>
          <p className="text-xs text-foreground opacity-70">{t('masterFx.description')}</p>
        </div>
        <button
          type="button"
          data-master-fx-all-off=""
          onClick={() => runtime.allOff()}
          className={cx(
            'shrink-0 px-3 rounded-md text-sm border border-lineHighlight bg-background text-foreground hover:border-foreground',
            touch ? 'min-h-11' : 'h-8',
          )}
        >
          {t('masterFx.allOff')}
        </button>
      </div>

      <FilterKnob runtime={runtime} touch={touch} />
      <p className="text-xs text-foreground opacity-50">{t('masterFx.filterHint')}</p>
      <Slider
        id="resonance"
        label={t('masterFx.resonance')}
        value={percent(settings.resonance)}
        min={0}
        max={100}
        step={1}
        text={`${percent(settings.resonance)}%`}
        onChange={(v) => runtime.setSettings({ resonance: v / 100 })}
        touch={touch}
      />

      <Group id="delay" title={t('masterFx.delay')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <FractionSelect
            id="delay-time"
            label={t('masterFx.delayTime')}
            value={settings.delay.fraction}
            choices={MASTER_FX_DELAY_FRACTIONS}
            onChange={(fraction) => runtime.setSettings({ delay: { fraction } })}
            touch={touch}
          />
          <Slider
            id="delay-feedback"
            label={t('masterFx.delayFeedback')}
            value={percent(settings.delay.feedback)}
            min={percent(feedbackMin)}
            max={percent(feedbackMax)}
            step={1}
            text={`${percent(settings.delay.feedback)}%`}
            onChange={(v) => runtime.setSettings({ delay: { feedback: v / 100 } })}
            touch={touch}
          />
          <Slider
            id="delay-level"
            label={t('masterFx.level')}
            value={percent(settings.delay.level)}
            min={0}
            max={100}
            step={1}
            text={`${percent(settings.delay.level)}%`}
            onChange={(v) => runtime.setSettings({ delay: { level: v / 100 } })}
            touch={touch}
          />
        </div>
        <HoldButton effect="delay" label={t('masterFx.delay')} runtime={runtime} touch={touch} />
      </Group>

      <Group id="reverb" title={t('masterFx.reverb')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider
            id="reverb-decay"
            label={t('masterFx.reverbDecay')}
            value={settings.reverb.decay}
            min={decayMin}
            max={decayMax}
            step={0.1}
            text={seconds(settings.reverb.decay)}
            onChange={(decay) => runtime.setSettings({ reverb: { decay } })}
            touch={touch}
          />
          <Slider
            id="reverb-level"
            label={t('masterFx.level')}
            value={percent(settings.reverb.level)}
            min={0}
            max={100}
            step={1}
            text={`${percent(settings.reverb.level)}%`}
            onChange={(v) => runtime.setSettings({ reverb: { level: v / 100 } })}
            touch={touch}
          />
        </div>
        <HoldButton effect="reverb" label={t('masterFx.reverb')} runtime={runtime} touch={touch} />
      </Group>

      <Group id="repeat" title={t('masterFx.repeat')}>
        <FractionSelect
          id="repeat-length"
          label={t('masterFx.repeatLength')}
          value={settings.repeatLength}
          choices={MASTER_FX_REPEAT_LENGTHS}
          onChange={(repeatLength) => runtime.setSettings({ repeatLength })}
          touch={touch}
        />
        <HoldButton effect="repeat" label={t('masterFx.repeat')} runtime={runtime} touch={touch} />
      </Group>

      <Group id="brake" title={t('masterFx.brake')}>
        <HoldButton effect="brake" label={t('masterFx.brake')} runtime={runtime} touch={touch} />
        <p className="text-xs text-foreground opacity-70" data-master-fx-brake-note="">
          {t('masterFx.brakeNote')}{' '}
          <a
            href={`#${SCRATCH_BRAKE_SLIDER_ID}`}
            data-master-fx-brake-link=""
            className="underline hover:opacity-100"
            onClick={(event) => {
              if (showScratchFeelSliders()) event.preventDefault();
            }}
          >
            {t('masterFx.brakeLink')}
          </a>
        </p>
      </Group>

      <p className="text-xs text-foreground opacity-50" data-master-fx-hold-hint="">
        {t('masterFx.holdHint')}
      </p>
    </section>
  );
}
