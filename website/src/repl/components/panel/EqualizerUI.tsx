import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from '@src/i18n';
import {
  type AudioEqualizer,
  type CutConfig,
  type CutUpdate,
  type EqualizerSettings,
  applyEqualizerSettings,
  EQUALIZER_PRESETS,
  EQUALIZER_PRESET_FAMILIES,
  HIGH_CUT_RANGE,
  LOW_CUT_RANGE,
  OUTPUT_GAIN_RANGE,
  saveEqualizerSettings,
  loadEqualizerSettings,
  getDefaultSettings,
  generateLogFrequencies,
  equalizerResponseDb,
  frequencyToX,
  gainToY,
  formatFrequency,
} from '@strudel/equalizer';
import { usePanelViewport } from './panelViewport';
import { getMainEqualizer, subscribeMainEqualizer } from '../../mainEqualizer';
import {
  EqualizerCompact,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_Q_MAX,
  EQ_Q_MIN,
  type CompactBandUpdate,
} from './EqualizerCompact';
import { EqualizerStripControls } from './EqualizerStripControls';
import { EqualizerPresetDescription } from './EqualizerPresetDescription';

interface EqualizerUIProps {
  /** The headphone PreviewEngine (its own EQ); null when it is not ready. */
  previewEngine: any;
  /** The main (speakers) EQ; defaults to the app's one from mainEqualizer.ts. */
  mainEqualizer?: AudioEqualizer | null;
}

interface BandControl {
  frequency: number;
  gain: number;
  Q: number;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;
/** The chart's dB range either side of 0 (the band range, spec 020). */
const CHART_RANGE = EQ_GAIN_MAX;
const CHART_GRID_DB = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
/** The limiting indicator lights when the main EQ's limiter turns the sound down by more than this (dB)… */
export const LIMITING_THRESHOLD_DB = -1;
/** …and stays lit this long after, so a pumping limiter does not flicker it (ms). */
const LIMITING_HOLD_MS = 250;

/** Preset key → its label key, e.g. 'flat' → 'equalizerPresetFlat'. */
const presetTranslationKey = (key: string) => `equalizerPreset${key.charAt(0).toUpperCase()}${key.slice(1)}`;

const FAMILY_LABELS = {
  brazilianLatin: 'equalizerFamilyBrazilianLatin',
  phonkHipHop: 'equalizerFamilyPhonkHipHop',
  electronic: 'equalizerFamilyElectronic',
  liveOther: 'equalizerFamilyLiveOther',
} as const;

/**
 * The picker's groups (spec 021): the four genre families in order, then the listening profiles.
 * Within a group, presets keep their order in EQUALIZER_PRESETS.
 */
export const PICKER_GROUPS: { id: string; label: string; keys: string[] }[] = [
  ...EQUALIZER_PRESET_FAMILIES.map((family) => ({
    id: family,
    label: FAMILY_LABELS[family],
    keys: Object.entries(EQUALIZER_PRESETS)
      .filter(([, preset]) => preset.group === 'genre' && preset.family === family)
      .map(([key]) => key),
  })),
  {
    id: 'profile',
    label: 'equalizerGroupProfiles',
    keys: Object.entries(EQUALIZER_PRESETS)
      .filter(([, preset]) => preset.group === 'profile')
      .map(([key]) => key),
  },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Keeps a band update inside the range the audio graph accepts and the saved-settings loader
 * validates (an out-of-range save would make the EQ start flat). Non-finite values are dropped.
 */
export function clampBandUpdate({ gain, Q }: CompactBandUpdate): CompactBandUpdate {
  const next: CompactBandUpdate = {};
  if (gain !== undefined && Number.isFinite(gain)) next.gain = clamp(gain, EQ_GAIN_MIN, EQ_GAIN_MAX);
  if (Q !== undefined && Number.isFinite(Q)) next.Q = clamp(Q, EQ_Q_MIN, EQ_Q_MAX);
  return next;
}

const clampCut = (cut: CutConfig, update: CutUpdate, range: { min: number; max: number }): CutConfig => ({
  enabled: typeof update.enabled === 'boolean' ? update.enabled : cut.enabled,
  frequency:
    update.frequency !== undefined && Number.isFinite(update.frequency)
      ? clamp(update.frequency, range.min, range.max)
      : cut.frequency,
});

export function EqualizerUI({ previewEngine, mainEqualizer }: EqualizerUIProps) {
  const { t } = useTranslation('settings');
  const [isEnabled, setIsEnabled] = useState(true);
  const [bands, setBands] = useState<BandControl[]>([]);
  const [activePreset, setActivePreset] = useState('flat');
  const defaults = getDefaultSettings();
  const [lowCut, setLowCut] = useState<CutConfig>(defaults.lowCut!);
  const [highCut, setHighCut] = useState<CutConfig>(defaults.highCut!);
  const [outputGain, setOutputGain] = useState(0);
  const [limiting, setLimiting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { compact } = usePanelViewport();
  const [selectedBand, setSelectedBand] = useState(0);

  // Every EQ the panel drives: the speakers' (main) and the headphones' (preview engine).
  // The app's main EQ is installed after the first click (once initAudio has picked the output
  // device), so it can appear after the panel mounted: re-render then. It loads the saved settings
  // itself, which include every change made here before it existed.
  const appMainEqualizer = useSyncExternalStore(subscribeMainEqualizer, getMainEqualizer, () => null);
  const equalizers = useCallback(
    (): AudioEqualizer[] =>
      [mainEqualizer ?? appMainEqualizer, previewEngine?.equalizer].filter((eq): eq is AudioEqualizer => !!eq),
    [mainEqualizer, appMainEqualizer, previewEngine],
  );

  const applySettingsToEqualizers = useCallback(
    (settings: any) => {
      // On/off first, then the bands: an EQ saved as off stays silent.
      equalizers().forEach((eq) => applyEqualizerSettings(eq, settings));
    },
    [equalizers],
  );

  // Load saved settings on mount
  useEffect(() => {
    const saved = loadEqualizerSettings();
    const settings = saved || getDefaultSettings();
    const fallback = getDefaultSettings();

    setIsEnabled(settings.isEnabled);
    setBands(settings.bands);
    setActivePreset(settings.preset);
    setLowCut(settings.lowCut ?? fallback.lowCut!);
    setHighCut(settings.highCut ?? fallback.highCut!);
    setOutputGain(settings.outputGain ?? 0);

    // Apply to equalizers
    applySettingsToEqualizers(settings);
  }, [applySettingsToEqualizers]);

  // The limiting indicator: poll the main (speakers) EQ's limiter once per frame while the panel is
  // mounted (requestAnimationFrame also pauses in a hidden tab); stopped on unmount.
  const speakersEqualizer = mainEqualizer ?? appMainEqualizer;
  useEffect(() => {
    // A new (or no) main EQ starts unlit: the poll's own `lit` starts false, so the state must too.
    setLimiting(false);
    if (!speakersEqualizer) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? // Called as plain functions: as methods of this object they throw "Illegal invocation".
          { request: (cb: () => void) => requestAnimationFrame(cb), cancel: (id: number) => cancelAnimationFrame(id) }
        : { request: (cb: () => void) => window.setTimeout(cb, 50), cancel: (id: number) => window.clearTimeout(id) };
    let frame = 0;
    let litAt = -Infinity;
    let lit = false;
    const poll = () => {
      const now = Date.now();
      if (speakersEqualizer.getLimiterReduction() < LIMITING_THRESHOLD_DB) litAt = now;
      const next = now - litAt < LIMITING_HOLD_MS;
      if (next !== lit) {
        lit = next;
        setLimiting(next);
      }
      frame = raf.request(poll);
    };
    frame = raf.request(poll);
    return () => raf.cancel(frame);
  }, [speakersEqualizer]);

  // Update frequency response chart when anything it shows changes
  useEffect(() => {
    updateFrequencyResponseChart();
  }, [bands, isEnabled, compact, selectedBand, lowCut, highCut, outputGain]);

  /** The full settings as saved, with `patch` applied (every control saves all of them). */
  const settingsWith = (patch: Partial<EqualizerSettings>): EqualizerSettings => ({
    isEnabled,
    preset: activePreset,
    bands,
    lowCut,
    highCut,
    outputGain,
    ...patch,
  });

  const updateFrequencyResponseChart = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    drawGrid(ctx, width, height);

    // Draw frequency response curve
    if (isEnabled) {
      drawFrequencyResponse(ctx, width, height);
    }

    // Draw band markers
    drawBandMarkers(ctx, width, height);
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    // Frequency lines (logarithmic)
    const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    frequencies.forEach((freq) => {
      const x = frequencyToX(freq, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatFrequency(freq), x, height - 5);
    });

    // Gain lines, every 6 dB over the ±24 dB range
    CHART_GRID_DB.forEach((gain) => {
      const y = gainToY(gain, height, CHART_RANGE);
      ctx.strokeStyle = gain === 0 ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Label (not on the ±24 dB edges: the top one is clipped, the bottom one hits the Hz labels)
      if (Math.abs(gain) === CHART_RANGE) return;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${gain > 0 ? '+' : ''}${gain}dB`, 5, y - 5);
    });
  };

  const drawFrequencyResponse = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const numPoints = 200;
    const frequencies = generateLogFrequencies(20, 20000, numPoints);

    // The exact response of the bands, cuts and output level (the same biquads the browser runs)
    const response = equalizerResponseDb({ bands, lowCut, highCut, outputGain }, frequencies);
    const yOf = (db: number) => clamp(gainToY(db, height, CHART_RANGE), 0, height);

    // Draw the curve
    ctx.strokeStyle = '#1db954'; // Spotify green
    ctx.lineWidth = 3;
    ctx.beginPath();

    for (let i = 0; i < numPoints; i++) {
      const x = frequencyToX(frequencies[i], width);
      const y = yOf(response[i]);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Add glow effect
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#1db954';
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const drawBandMarkers = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    // The cut corners, when on
    [lowCut, highCut].forEach((cut) => {
      if (!cut.enabled) return;
      const x = frequencyToX(cut.frequency, width);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash?.([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash?.([]);
    });

    bands.forEach((band, index) => {
      const x = frequencyToX(band.frequency, width);
      const y = gainToY(band.gain, height, CHART_RANGE);

      // Compact only: ring the band the sliders below are editing.
      if (compact && index === selectedBand) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw marker
      ctx.fillStyle = band.gain === 0 ? 'rgba(255, 255, 255, 0.3)' : '#1db954';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw line from zero to current gain
      const zeroY = gainToY(0, height, CHART_RANGE);
      ctx.strokeStyle = 'rgba(29, 185, 84, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, zeroY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });
  };

  const handleEnableToggle = () => {
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);

    equalizers().forEach((eq) => eq.setEnabled(newEnabled));

    saveEqualizerSettings(settingsWith({ isEnabled: newEnabled }));
  };

  // The one band setter, used by the desktop grid and the compact sliders. setBand keeps the
  // "EQ off stays silent" rule: it stores the value and only applies it while the EQ is on.
  const handleBandChange = (index: number, update: CompactBandUpdate) => {
    if (index < 0 || index >= bands.length) return;
    const next = clampBandUpdate(update);
    if (next.gain === undefined && next.Q === undefined) return;

    const newBands = [...bands];
    newBands[index] = { ...newBands[index], ...next };
    setBands(newBands);

    equalizers().forEach((eq) => eq.setBand(index, next));

    setActivePreset('custom');
    saveEqualizerSettings(settingsWith({ bands: newBands, preset: 'custom' }));
  };

  // The cuts and the output level: like a band, each change drives both EQs (stored always, heard
  // only while on), makes the preset Custom and saves.
  const handleCutChange = (which: 'low' | 'high', update: CutUpdate) => {
    const current = which === 'low' ? lowCut : highCut;
    const next = clampCut(current, update, which === 'low' ? LOW_CUT_RANGE : HIGH_CUT_RANGE);
    if (next.enabled === current.enabled && next.frequency === current.frequency) return;

    if (which === 'low') setLowCut(next);
    else setHighCut(next);
    equalizers().forEach((eq) => (which === 'low' ? eq.setLowCut(next) : eq.setHighCut(next)));

    setActivePreset('custom');
    saveEqualizerSettings(settingsWith({ [which === 'low' ? 'lowCut' : 'highCut']: next, preset: 'custom' }));
  };

  const handleOutputGainChange = (db: number) => {
    if (!Number.isFinite(db)) return;
    const next = clamp(db, OUTPUT_GAIN_RANGE.min, OUTPUT_GAIN_RANGE.max);
    if (next === outputGain) return;

    setOutputGain(next);
    equalizers().forEach((eq) => eq.setOutputGain(next));

    setActivePreset('custom');
    saveEqualizerSettings(settingsWith({ outputGain: next, preset: 'custom' }));
  };

  const handlePresetChange = (presetName: string) => {
    const preset = EQUALIZER_PRESETS[presetName];
    if (!preset) return;

    const newBands = bands.map((band, i) => ({
      ...band,
      gain: preset.gains[i],
    }));
    // A preset sets the cuts and the output too; one without cuts (a listening profile) turns them
    // off (keeping their frequencies) at 0 dB output. Same rule as AudioEqualizer.applyPreset.
    const newLowCut =
      preset.lowCut != null ? { enabled: true, frequency: preset.lowCut } : { ...lowCut, enabled: false };
    const newHighCut =
      preset.highCut != null ? { enabled: true, frequency: preset.highCut } : { ...highCut, enabled: false };
    const newOutputGain = preset.outputGain ?? 0;

    setBands(newBands);
    setLowCut(newLowCut);
    setHighCut(newHighCut);
    setOutputGain(newOutputGain);
    setActivePreset(presetName);

    equalizers().forEach((eq) => eq.applyPreset(presetName));

    saveEqualizerSettings(
      settingsWith({
        bands: newBands,
        lowCut: newLowCut,
        highCut: newHighCut,
        outputGain: newOutputGain,
        preset: presetName,
      }),
    );
  };

  const handleReset = () => {
    if (confirm(t('equalizerResetConfirm'))) {
      handlePresetChange('flat');
    }
  };

  if (equalizers().length === 0) {
    return (
      <div className="p-4 bg-lineHighlight rounded-lg">
        <div className="flex items-center gap-2 text-foreground opacity-70">
          <span className="text-sm">{t('equalizerNotAvailable')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with enable/disable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('equalizer')}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{t('equalizerSubtitle')}</p>
        </div>
        <button
          onClick={handleEnableToggle}
          aria-pressed={compact ? isEnabled : undefined}
          className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
            isEnabled
              ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-500/30'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }${compact ? ' min-h-11 min-w-11 shrink-0' : ''}`}
        >
          <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-white' : 'bg-gray-500'}`}></div>
          {isEnabled ? t('equalizerEnabled') : t('equalizerDisabled')}
        </button>
      </div>

      {/* Preset selector */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t('equalizerPreset')}</label>
        <div className="relative">
          <select
            className={`w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 cursor-pointer hover:border-gray-600${
              compact ? ' min-h-11' : ''
            }`}
            value={activePreset}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            {PICKER_GROUPS.map(({ id, label, keys }) => (
              <optgroup key={id} label={t(label)} data-eq-group={id} className="bg-gray-800">
                {keys.map((key) => (
                  <option key={key} value={key} className="bg-gray-800">
                    {t(presetTranslationKey(key))}
                  </option>
                ))}
              </optgroup>
            ))}
            {activePreset === 'custom' && (
              <option value="custom" className="bg-gray-800">
                {t('equalizerCustom')}
              </option>
            )}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {activePreset === 'custom' && (
          <div className="mt-2 text-xs text-green-400 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {t('equalizerCustomActive')}
          </div>
        )}
        {/* What the settings do, and why for a genre preset (spec 021; both layouts) */}
        <EqualizerPresetDescription
          bands={bands}
          lowCut={lowCut}
          highCut={highCut}
          outputGain={outputGain}
          activePreset={activePreset}
        />
      </div>

      {compact ? (
        <EqualizerCompact
          bands={bands}
          selectedBand={selectedBand}
          onSelectBand={setSelectedBand}
          onBandChange={handleBandChange}
          canvasRef={canvasRef}
          canvasWidth={CANVAS_WIDTH}
          canvasHeight={CANVAS_HEIGHT}
        />
      ) : (
        <>
          {/* Frequency Response Chart */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-foreground">{t('equalizerFrequencyResponse')}</label>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-0.5 bg-green-500"></div>
                  <span>{t('equalizerEQCurve')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span>{t('equalizerBands')}</span>
                </div>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full h-auto bg-black rounded border border-gray-800"
            />
          </div>

          {/* Band controls */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">{t('equalizerFrequencyBands')}</label>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
              {bands.map((band, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center group relative"
                  title={`${band.frequency}Hz: ${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)}dB`}
                >
                  {/* Frequency label */}
                  <div className="text-xs text-foreground opacity-70 mb-2 font-mono">
                    {band.frequency >= 1000
                      ? `${(band.frequency / 1000).toFixed(band.frequency === 1000 ? 0 : 1)}k`
                      : `${band.frequency}`}
                  </div>

                  {/* Vertical slider container with visual feedback */}
                  <div className="relative h-32 w-8 bg-gray-800 rounded-lg overflow-hidden border border-gray-700 group-hover:border-green-500 transition-colors">
                    {/* Zero line indicator */}
                    <div className="absolute left-0 right-0 h-0.5 bg-gray-600 z-10" style={{ top: '50%' }} />

                    {/* Gain level indicator */}
                    <div
                      className={`absolute left-0 right-0 transition-all duration-150 ${
                        band.gain > 0
                          ? 'bg-gradient-to-t from-green-500/50 to-green-400/30'
                          : band.gain < 0
                            ? 'bg-gradient-to-b from-red-500/50 to-red-400/30'
                            : ''
                      }`}
                      style={{
                        top: band.gain > 0 ? `${50 - (band.gain / EQ_GAIN_MAX) * 50}%` : '50%',
                        bottom: band.gain < 0 ? `${50 - (Math.abs(band.gain) / EQ_GAIN_MAX) * 50}%` : '50%',
                      }}
                    />

                    {/* Slider input */}
                    <input
                      type="range"
                      min={EQ_GAIN_MIN}
                      max={EQ_GAIN_MAX}
                      step="0.5"
                      value={band.gain}
                      onChange={(e) => handleBandChange(index, { gain: parseFloat(e.target.value) })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                      style={{
                        WebkitAppearance: 'slider-vertical' as any,
                      }}
                    />

                    {/* Gain value indicator dot */}
                    <div
                      className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-30 transition-all duration-150 ${
                        band.gain === 0 ? 'bg-gray-400' : 'bg-green-400 shadow-lg shadow-green-500/50'
                      }`}
                      style={{
                        top: `${50 - (band.gain / EQ_GAIN_MAX) * 50}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    />
                  </div>

                  {/* Gain value display */}
                  <div
                    className={`text-xs font-mono font-medium mt-2 transition-colors ${
                      band.gain === 0 ? 'text-gray-500' : band.gain > 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {band.gain > 0 ? '+' : ''}
                    {band.gain.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>

            {/* Info text */}
            <div className="text-xs text-foreground opacity-50 text-center mt-2">
              {t('equalizerDragSliders')} • {t('equalizerRange')}
            </div>
          </div>
        </>
      )}

      {/* Low cut, high cut, output level and the limiting indicator (both layouts) */}
      <EqualizerStripControls
        lowCut={lowCut}
        highCut={highCut}
        outputGain={outputGain}
        limiting={limiting}
        compact={compact}
        onLowCutChange={(update) => handleCutChange('low', update)}
        onHighCutChange={(update) => handleCutChange('high', update)}
        onOutputGainChange={handleOutputGainChange}
      />

      {/* Reset button */}
      <button
        onClick={handleReset}
        className={`w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-foreground hover:bg-gray-700 hover:border-gray-600 transition-all duration-200 flex items-center justify-center gap-2 group${
          compact ? ' min-h-11' : ''
        }`}
      >
        <svg
          className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {t('equalizerResetToFlat')}
      </button>
    </div>
  );
}
