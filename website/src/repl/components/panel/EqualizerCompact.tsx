import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useTranslation } from '@src/i18n';
import { frequencyToX, formatFrequency } from '@strudel/equalizer';

export interface CompactBand {
  frequency: number;
  gain: number;
  Q: number;
}

export interface CompactBandUpdate {
  gain?: number;
  Q?: number;
}

/** The same ranges the desktop slider offers and AudioEqualizer.setBand clamps to. */
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_GAIN_STEP = 0.5;
export const EQ_Q_MIN = 0.5;
export const EQ_Q_MAX = 4;

/**
 * The band whose marker is nearest to x (in canvas pixels), using the same frequency-to-x mapping
 * the curve is drawn with. Returns -1 when there are no bands.
 */
export function nearestBandIndex(bands: CompactBand[], x: number, width: number): number {
  let best = -1;
  let bestDistance = Infinity;
  bands.forEach((band, index) => {
    const distance = Math.abs(frequencyToX(band.frequency, width) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** A pointer's clientX in the canvas's own pixel space (the canvas is scaled to the sheet width by CSS). */
export function canvasXFromClientX(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width > 0 ? canvas.width / rect.width : 1;
  return (clientX - rect.left) * scale;
}

const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
const formatHz = (frequency: number) => `${formatFrequency(frequency)}Hz`;

// 44px tall hit area, and no browser panning while a finger drags the thumb (the sheet must not scroll).
const SLIDER_CLASS = 'w-full h-11 bg-transparent cursor-pointer accent-green-500 touch-none';

interface EqualizerCompactProps {
  bands: CompactBand[];
  selectedBand: number;
  onSelectBand: (index: number) => void;
  /** The same band setter the desktop grid uses (clamps, saves, and keeps the EQ-off rule). */
  onBandChange: (index: number, update: CompactBandUpdate) => void;
  canvasRef: RefObject<HTMLCanvasElement>;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * The phone layout of the EQ: the whole curve at the sheet's width, band chips 1-10, and a large
 * gain slider for the one selected band. UI only: every change goes through the desktop band setter.
 */
export function EqualizerCompact({
  bands,
  selectedBand,
  onSelectBand,
  onBandChange,
  canvasRef,
  canvasWidth,
  canvasHeight,
}: EqualizerCompactProps) {
  const { t } = useTranslation('settings');
  const dragging = useRef(false);
  const band = bands[selectedBand];

  const selectAt = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const index = nearestBandIndex(bands, canvasXFromClientX(canvas, clientX), canvas.width);
    if (index >= 0 && index !== selectedBand) onSelectBand(index);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    selectAt(e.clientX);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragging.current) selectAt(e.clientX);
  };

  const endDrag = () => {
    dragging.current = false;
  };

  return (
    <div className="space-y-3" data-eq-compact>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-2">
        <label className="block text-sm font-medium text-foreground mb-2">{t('equalizerFrequencyResponse')}</label>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          data-eq-canvas
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="block w-full h-auto bg-black rounded border border-gray-800 touch-none cursor-pointer"
        />
      </div>

      <div className="grid grid-cols-5 gap-2" role="group" aria-label={t('equalizerFrequencyBands')}>
        {bands.map((b, index) => (
          <button
            key={index}
            type="button"
            data-eq-chip={index}
            aria-pressed={index === selectedBand}
            aria-label={t('common:eqBand', { n: index + 1 })}
            onClick={() => onSelectBand(index)}
            className={`min-h-11 min-w-11 rounded-lg border text-xs font-mono flex flex-col items-center justify-center ${
              index === selectedBand
                ? 'bg-green-600 border-green-500 text-white'
                : 'bg-gray-800 border-gray-700 text-foreground'
            }`}
          >
            <span className="font-medium">{index + 1}</span>
            <span className="opacity-70">{formatFrequency(b.frequency)}</span>
          </button>
        ))}
      </div>

      {band && (
        <div className="space-y-2 p-3 bg-gray-900 border border-gray-700 rounded-lg" data-eq-band-controls>
          {/* Read-only: the band centres are fixed in the audio graph; select a band on the curve or the chips. */}
          <div className="text-sm font-medium text-foreground">
            {t('common:eqBand', { n: selectedBand + 1 })} ·{' '}
            <span className="font-mono" data-eq-value="frequency">
              {formatHz(band.frequency)}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-sm text-foreground">
              <label htmlFor="eq-compact-gain">{t('common:gain')}</label>
              <output htmlFor="eq-compact-gain" className="font-mono" data-eq-value="gain">
                {formatGain(band.gain)}
              </output>
            </div>
            <input
              id="eq-compact-gain"
              data-eq-slider="gain"
              type="range"
              min={EQ_GAIN_MIN}
              max={EQ_GAIN_MAX}
              step={EQ_GAIN_STEP}
              value={band.gain}
              onChange={(e) => onBandChange(selectedBand, { gain: parseFloat(e.target.value) })}
              className={SLIDER_CLASS}
            />
          </div>
        </div>
      )}
    </div>
  );
}
