/**
 * A Master FX hold button (spec 032 §2.6, §2.8; tech §2.7): the effect plays while the button is held.
 *
 * - Pointer (mouse, touch, pen): pointerdown captures the pointer and holds as `pointer:<id>`; pointerup,
 *   pointercancel and lostpointercapture release it. Losing the window or the tab going hidden is the
 *   runtime's (it releases every pointer and key holder).
 * - Keyboard: Space or Enter keydown (not auto-repeat) holds as `key`, keyup releases; the button
 *   losing focus while held releases too.
 * - Lit (and `aria-pressed`) from the runtime's `held` store, so a hold from MIDI or another button
 *   shows here too. A refused hold (the Brake while the platter holds the record) stays dark.
 */
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { masterFxRuntime, type MasterFxEffect, type MasterFxRuntime } from '../../masterFx/masterFxRuntime';

const HOLD_KEYS = new Set([' ', 'Enter', 'Spacebar']);

export function HoldButton({
  effect,
  label,
  runtime = masterFxRuntime,
  touch = false,
  strip = false,
}: {
  effect: MasterFxEffect;
  label: string;
  runtime?: Pick<MasterFxRuntime, 'held' | 'hold' | 'release'>;
  /** Finger-sized (the compact layout). */
  touch?: boolean;
  /** The performance strip's small size. */
  strip?: boolean;
}) {
  const { t } = useTranslation('settings');
  const held = useStore(runtime.held)[effect];
  const pointers = useRef(new Set<number>());
  const keyHeld = useRef(false);
  const latest = useRef({ runtime, effect });
  latest.current = { runtime, effect };

  // Review 032 #3: the runtime let go by itself (window blur, tab hidden, All FX off, Stop): forget
  // this button's own pointers and key, so the next press with the same pointer id (a mouse is always
  // 1) or the same key holds again instead of being taken for one still down.
  useEffect(() => {
    if (held) return;
    pointers.current.clear();
    keyHeld.current = false;
  }, [held]);

  // Unmounted while held (the performance view closing): let go of what this button holds.
  useEffect(
    () => () => {
      const { runtime: r, effect: e } = latest.current;
      for (const id of pointers.current) r.release(e, `pointer:${id}`);
      pointers.current.clear();
      if (keyHeld.current) r.release(e, 'key');
      keyHeld.current = false;
    },
    [],
  );

  const releasePointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    runtime.release(effect, `pointer:${event.pointerId}`);
  };

  const releaseKey = () => {
    if (!keyHeld.current) return;
    keyHeld.current = false;
    runtime.release(effect, 'key');
  };

  return (
    <button
      type="button"
      data-master-fx-hold={effect}
      data-held={held ? 'true' : undefined}
      aria-pressed={held}
      aria-label={t('masterFx.holdLabel', { effect: label })}
      title={t('masterFx.holdLabel', { effect: label })}
      className={cx(
        'shrink-0 rounded-md border text-sm select-none touch-none transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground',
        held
          ? 'border-orange-400 bg-orange-400 bg-opacity-20 text-orange-300 shadow-[0_0_10px_rgba(251,146,60,0.45)]'
          : 'border-lineHighlight bg-background text-foreground hover:border-foreground',
        strip ? 'h-8 px-2 text-xs' : touch ? 'min-h-11 px-4' : 'h-9 px-3',
      )}
      onPointerDown={(event) => {
        // A mouse holds with its main button only; touch and pen with any contact.
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch (error: unknown) {
          // Not capturable (already released): the pointerup still reaches the button.
        }
        if (pointers.current.has(event.pointerId)) return;
        if (runtime.hold(effect, `pointer:${event.pointerId}`)) pointers.current.add(event.pointerId);
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!HOLD_KEYS.has(event.key)) return;
        event.preventDefault();
        if (event.repeat || keyHeld.current) return;
        if (runtime.hold(effect, 'key')) keyHeld.current = true;
      }}
      onKeyUp={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (!HOLD_KEYS.has(event.key)) return;
        event.preventDefault();
        releaseKey();
      }}
      onBlur={releaseKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}
