import { useTranslation } from '@src/i18n';
import { HIGH_CUT_RANGE, LOW_CUT_RANGE, OUTPUT_GAIN_RANGE, type CutConfig, type CutUpdate } from '@strudel/equalizer';

/** Slider resolution of the log-scale cut sliders (positions 0…CUT_SLIDER_STEPS). */
export const CUT_SLIDER_STEPS = 1000;
export const OUTPUT_GAIN_STEP = 0.5;

type Range = { min: number; max: number };

/** A cut frequency (Hz) as a log-scale slider position, 0…CUT_SLIDER_STEPS. */
export function cutFrequencyToPosition(frequency: number, range: Range): number {
  const f = Math.max(range.min, Math.min(range.max, frequency));
  return Math.round((CUT_SLIDER_STEPS * Math.log(f / range.min)) / Math.log(range.max / range.min));
}

/** A log-scale slider position as a cut frequency (Hz), rounded to 1 Hz below 1 kHz and 10 Hz above. */
export function positionToCutFrequency(position: number, range: Range): number {
  const p = Math.max(0, Math.min(CUT_SLIDER_STEPS, position));
  const f = range.min * Math.pow(range.max / range.min, p / CUT_SLIDER_STEPS);
  const rounded = f < 1000 ? Math.round(f) : Math.round(f / 10) * 10;
  return Math.max(range.min, Math.min(range.max, rounded));
}

/** "200 Hz", "2.0 kHz". */
export function formatCutFrequency(frequency: number): string {
  return frequency < 1000 ? `${Math.round(frequency)} Hz` : `${(frequency / 1000).toFixed(1)} kHz`;
}

const formatDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

interface EqualizerStripControlsProps {
  lowCut: CutConfig;
  highCut: CutConfig;
  outputGain: number;
  /** The limiter is turning the sound down (the main EQ's reduction is past −1 dB). */
  limiting: boolean;
  /** Phone layout: 44px touch targets. */
  compact: boolean;
  onLowCutChange: (update: CutUpdate) => void;
  onHighCutChange: (update: CutUpdate) => void;
  onOutputGainChange: (db: number) => void;
}

/**
 * The EQ's low cut, high cut and output level, with the "limiting" indicator (spec 020). UI only:
 * every change goes through the panel's setters, which drive both EQs and save.
 */
export function EqualizerStripControls({
  lowCut,
  highCut,
  outputGain,
  limiting,
  compact,
  onLowCutChange,
  onHighCutChange,
  onOutputGainChange,
}: EqualizerStripControlsProps) {
  const { t } = useTranslation('settings');
  const target = compact ? ' min-h-11 min-w-11' : '';
  const sliderClass = `w-full ${compact ? 'h-11' : 'h-6'} bg-transparent cursor-pointer accent-green-500 touch-none`;

  const cutRow = (
    name: 'lowCut' | 'highCut',
    label: string,
    cut: CutConfig,
    range: Range,
    onChange: (update: CutUpdate) => void,
  ) => (
    <div className="space-y-1" data-eq-cut={name}>
      <div className="flex items-center justify-between gap-2 text-sm text-foreground">
        <label htmlFor={`eq-${name}`} className="font-medium">
          {label}
        </label>
        <button
          type="button"
          data-eq-toggle={name}
          aria-pressed={cut.enabled}
          aria-label={label}
          onClick={() => onChange({ enabled: !cut.enabled })}
          className={`px-3 py-1 rounded-lg border text-xs font-mono transition-colors${target} ${
            cut.enabled
              ? 'bg-green-600 border-green-500 text-white'
              : 'bg-gray-800 border-gray-700 text-foreground opacity-70'
          }`}
        >
          <span data-eq-value={name}>{cut.enabled ? formatCutFrequency(cut.frequency) : t('equalizerCutOff')}</span>
        </button>
      </div>
      <input
        id={`eq-${name}`}
        data-eq-slider={name}
        type="range"
        min={0}
        max={CUT_SLIDER_STEPS}
        step={1}
        value={cutFrequencyToPosition(cut.frequency, range)}
        aria-valuetext={formatCutFrequency(cut.frequency)}
        onChange={(e) => onChange({ frequency: positionToCutFrequency(parseFloat(e.target.value), range) })}
        className={`${sliderClass}${cut.enabled ? '' : ' opacity-50'}`}
      />
    </div>
  );

  return (
    <div className="space-y-3 p-3 bg-gray-900 border border-gray-700 rounded-lg" data-eq-strip>
      <div className={compact ? 'space-y-3' : 'grid grid-cols-2 gap-4'}>
        {cutRow('lowCut', t('equalizerLowCut'), lowCut, LOW_CUT_RANGE, onLowCutChange)}
        {cutRow('highCut', t('equalizerHighCut'), highCut, HIGH_CUT_RANGE, onHighCutChange)}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-sm text-foreground">
          <label htmlFor="eq-output" className="font-medium">
            {t('equalizerOutputLevel')}
          </label>
          <div className="flex items-center gap-2">
            <span
              role="status"
              data-eq-limiting={limiting ? 'on' : 'off'}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                limiting ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-500'
              }`}
            >
              {t('equalizerLimiting')}
            </span>
            <output htmlFor="eq-output" className="font-mono" data-eq-value="output">
              {formatDb(outputGain)}
            </output>
          </div>
        </div>
        <input
          id="eq-output"
          data-eq-slider="output"
          type="range"
          min={OUTPUT_GAIN_RANGE.min}
          max={OUTPUT_GAIN_RANGE.max}
          step={OUTPUT_GAIN_STEP}
          value={outputGain}
          onChange={(e) => onOutputGainChange(parseFloat(e.target.value))}
          className={sliderClass}
        />
      </div>
    </div>
  );
}
