/**
 * Who holds a MIDI control, by name in the current language (spec 031 §2.2, review #7): the jog,
 * a feel knob, or a MIDI map target. Shared by the MIDI panel and the scratch section, so a refused
 * Learn names the same holder everywhere.
 */
import type { MidiControlHolder } from '@strudel/mixer';
import { MIDI_TARGETS } from './midiTargetMeta';

type T = (key: string, options?: Record<string, unknown>) => string;

/** `holder.owner` is `'jog'`, `'feel:brake'`, `'feel:spinUp'` or `'map:<targetId>'`. */
export function holderName(t: T, holder: Pick<MidiControlHolder, 'owner'> & { label?: string }): string {
  if (holder.owner === 'jog') return t('midiTargetJog');
  if (holder.owner === 'feel:brake') return t('midiTargetBrake');
  if (holder.owner === 'feel:spinUp') return t('midiTargetSpinUp');
  if (holder.owner.startsWith('map:')) {
    const meta = MIDI_TARGETS.find((candidate) => candidate.id === holder.owner.slice(4));
    if (meta) return t(meta.labelKey, meta.labelParams ?? {});
  }
  return holder.label ?? holder.owner;
}

/**
 * The owner a jog or feel Learn's conflict names: `with` is `'jog'`, `'brake'`, `'spinUp'` or
 * `'map'` (then `target` is the map target id).
 */
export function conflictOwner(conflict: { with: string; target?: string }): string {
  if (conflict.with === 'map') return `map:${conflict.target ?? ''}`;
  if (conflict.with === 'jog') return 'jog';
  return `feel:${conflict.with}`;
}
