/**
 * The loudness history (spec 033 functional §2.6, tech §2.4): the last 60 s on a canvas, Short-term as
 * a line, Momentary as a fainter line, the target as a dashed line and a mark where a warning started.
 * Old is on the left and now on the right in every language (`dir="ltr"`).
 *
 * It redraws in one animation frame after the history changes, only while it is mounted (the Settings
 * tab is shown) and the tab is visible; a change while hidden is drawn when the tab shows again. The
 * history stops changing on Stop, so the graph freezes.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from '@src/i18n';
import {
  loudnessRuntime,
  LOUDNESS_HISTORY_LENGTH,
  type LoudnessHistoryEntry,
  type LoudnessRuntime,
} from '../../meter/loudnessRuntime';

/** The graph's loudness axis, LUFS. */
export const HISTORY_RANGE = Object.freeze({ min: -48, max: 0 });
const GRID_LUFS = [-36, -24, -12];

/** The y of a loudness on a canvas `height` tall (clamped to the axis). */
export function historyY(lufs: number, height: number): number {
  const clamped = Math.min(HISTORY_RANGE.max, Math.max(HISTORY_RANGE.min, lufs));
  return ((HISTORY_RANGE.max - clamped) / (HISTORY_RANGE.max - HISTORY_RANGE.min)) * height;
}

/** The x of entry `index` of `count`, newest at the right edge; 600 entries span the width. */
export function historyX(index: number, count: number, width: number): number {
  const slot = LOUDNESS_HISTORY_LENGTH - count + index;
  return (slot / (LOUDNESS_HISTORY_LENGTH - 1)) * width;
}

/** Draw the history on `ctx` (pure apart from the canvas calls; tests pass a recording context). */
export function drawHistory(
  ctx: CanvasRenderingContext2D,
  entries: readonly LoudnessHistoryEntry[],
  target: number | null,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  for (const lufs of GRID_LUFS) {
    const y = historyY(lufs, height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  if (target !== null) {
    const y = historyY(target, height);
    ctx.save();
    ctx.setLineDash?.([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.restore();
  }
  const count = entries.length;
  ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
  entries.forEach((entry, index) => {
    if (entry.warn) ctx.fillRect(historyX(index, count, width) - 1, 0, 2, 6);
  });
  const line = (pick: (entry: LoudnessHistoryEntry) => number | null, style: string, lineWidth: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let drawing = false;
    entries.forEach((entry, index) => {
      const value = pick(entry);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        drawing = false; // silence breaks the line
        return;
      }
      const x = historyX(index, count, width);
      const y = historyY(value, height);
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    });
    ctx.stroke();
  };
  line((entry) => entry.m, 'rgba(96, 165, 250, 0.35)', 1);
  line((entry) => entry.s, 'rgba(29, 185, 84, 0.95)', 2);
}

export function LoudnessHistory({
  runtime = loudnessRuntime,
  target,
}: {
  runtime?: LoudnessRuntime;
  target: number | null;
}) {
  const { t } = useTranslation('settings');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame: number | null = null;
    let dirty = true;
    const draw = () => {
      frame = null;
      if (typeof document !== 'undefined' && document.hidden) return; // drawn when shown again
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      dirty = false;
      drawHistory(ctx, runtime.history.get(), target, canvas.width, canvas.height);
    };
    const request = () => {
      dirty = true;
      if (frame !== null || (typeof document !== 'undefined' && document.hidden)) return;
      frame = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (dirty) request();
    };
    const unlisten = runtime.history.listen(request);
    document.addEventListener('visibilitychange', onVisibility);
    request();
    return () => {
      unlisten();
      document.removeEventListener('visibilitychange', onVisibility);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [runtime, target]);

  return (
    <div className="space-y-1" data-loudness-history="">
      <div className="text-xs text-foreground opacity-60">{t('meter.history')}</div>
      <canvas
        ref={canvasRef}
        dir="ltr"
        width={600}
        height={96}
        role="img"
        aria-label={t('meter.historyLabel')}
        className="w-full h-24 rounded border border-lineHighlight bg-black/20"
      />
    </div>
  );
}
