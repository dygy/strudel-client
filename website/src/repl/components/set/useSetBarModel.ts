/**
 * What the set bar shows and does (spec 022 §2.3), shared by SetBar and the performance strip
 * (spec 030 §2.2) so Now / Next and the Cue/Go button are the same texts and the same action.
 * Null while no set plays (signed out, read-only, or no set started).
 */
import { useTranslation } from '@src/i18n';
import { useSetPlayerContext, type SetPlayerContextValue } from '../../sets/useSetPlayer';
import { itemTextById } from './setLabels';

export interface SetBarModel {
  ctx: SetPlayerContextValue;
  /** "Now" item text. */
  now: string;
  /** "Up next" item text, or "End of set". */
  next: string;
  endOfSet: boolean;
  mode: 'cue' | 'go';
  /** A Cue or a Go is in flight. */
  busy: boolean;
  /** The button can't be pressed now. */
  disabled: boolean;
  /** "Cue" or "Go". */
  label: string;
  /** The same as Alt+Shift+N. */
  press: () => void;
}

export function useSetBarModel(): SetBarModel | null {
  const ctx = useSetPlayerContext();
  const { t } = useTranslation('settings');
  if (!ctx || !ctx.enabled || !ctx.player.setId) return null;
  const set = ctx.sets.find((candidate) => candidate.id === ctx.player.setId);
  const now = itemTextById(t, set?.items, ctx.player.nowItemId, ctx.tracks);
  const next = ctx.endOfSet ? t('setListEndOfSet') : itemTextById(t, set?.items, ctx.player.nextItemId, ctx.tracks);
  const mode = ctx.buttonMode;
  const busy = ctx.player.phase === 'cueing' || ctx.player.phase === 'going';
  return {
    ctx,
    now,
    next,
    endOfSet: ctx.endOfSet,
    mode,
    busy,
    disabled: busy || (mode === 'cue' && ctx.endOfSet),
    label: mode === 'go' ? t('setListGo') : t('setListCue'),
    press: () => ctx.press(),
  };
}
