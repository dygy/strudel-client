/**
 * The loudness meter's latching warning light (spec 033 functional §2.4, tech §2.4). Lit until clicked
 * (or the panel's Reset), however short the overload was. Its label names the reasons seen with their
 * counts ("Limiter working (3×) — click to clear"); a long press on touch shows the same text, and the
 * click that ends a long press does not clear it.
 */
import { useEffect, useRef, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import type { LoudnessOverReason } from '@strudel/mixer';
import type { LoudnessWarning } from '../../meter/loudnessRuntime';
import { warningText } from '../../meter/loudnessFormat';

/** How long a press must last to show the text instead of clearing (ms). */
export const WARNING_LONG_PRESS_MS = 500;

export function WarningLight({
  warning,
  events,
  onClear,
  className,
}: {
  warning: LoudnessWarning;
  events: Partial<Record<LoudnessOverReason, number>> | null | undefined;
  onClear: () => void;
  className?: string;
}) {
  const { t } = useTranslation('settings');
  const text = warningText(t, warning, events);
  const [tooltip, setTooltip] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => cancelPress, []);
  useEffect(() => {
    if (!tooltip) return;
    const hide = setTimeout(() => setTooltip(false), 3000);
    return () => clearTimeout(hide);
  }, [tooltip]);

  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      <button
        type="button"
        data-loudness-warning={warning.lit ? 'on' : 'off'}
        aria-label={text}
        title={text}
        onPointerDown={(event) => {
          longPressed.current = false;
          if (event.pointerType !== 'touch') return;
          cancelPress();
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            setTooltip(true);
          }, WARNING_LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => {
          // A long press on touch opens the context menu in some browsers; the tooltip replaces it.
          if (pressTimer.current || longPressed.current) event.preventDefault();
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          if (warning.lit) onClear();
        }}
        className={cx(
          'h-4 w-4 rounded-full border transition-colors',
          warning.lit
            ? 'bg-amber-500 border-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.8)] cursor-pointer'
            : 'bg-lineHighlight border-lineHighlight opacity-60 cursor-default',
        )}
      />
      {tooltip && (
        <span
          role="tooltip"
          data-loudness-warning-tooltip=""
          className="absolute top-full mt-1 z-50 w-max max-w-[16rem] rounded bg-background border border-lineHighlight px-2 py-1 text-xs text-foreground shadow-lg"
          style={{ insetInlineEnd: 0 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
