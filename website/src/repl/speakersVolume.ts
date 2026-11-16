/**
 * The speakers volume (spec 031 tech §2.4): one permanent GainNode per main AudioContext, the very
 * last node before the speakers.
 *
 *   superdough destinationGain → [main EQ input … EQ output] → speakers volume → audioContext.destination
 *
 * mainEqualizer.ts connects the EQ's output here instead of to the destination, and when the EQ goes
 * away it makes this node superdough's output insert, so from the first EQ install on the volume is
 * always last. superdough's reset() rebuilds destinationGain but keeps the insert (the EQ), so this node
 * is never touched by it, nor by the EQ's click-free swap (spec 020). It is separate from
 * destinationGain, which the Dip transition automates: a Dip's restore returns to unity × volume.
 * Recorders (destinationGain or the EQ output tap) and the spec 030 meter tap upstream of it, so the
 * room level doesn't change a recording.
 *
 * The level (0..1, squared taper, 1 = exactly unity) is remembered in localStorage
 * `strudel-volume-speakers`. Every change is a 20 ms ramp (volume.mjs setVolume).
 */
import {
  SPEAKERS_VOLUME_STORAGE_KEY,
  clampVolume,
  createVolumeNode,
  readVolume,
  setVolume,
  writeVolume,
} from '@strudel/mixer';
import { getAudioContext } from '@strudel/webaudio';

const nodes = new WeakMap<BaseAudioContext, GainNode>();
/** The context whose node was made last (the one the app plays through); ramps go there. */
let current: { ctx: BaseAudioContext; node: GainNode } | null = null;
let level: number | null = null;
const listeners = new Set<(level: number) => void>();

const storage = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);

/** The speakers volume level, 0..1 (1 = unity, the default). */
export function getSpeakersVolume(): number {
  if (level === null) level = readVolume(storage(), SPEAKERS_VOLUME_STORAGE_KEY);
  return level;
}

/**
 * The speakers volume node of `audioContext` (default: the global context the app plays through),
 * created once per context at the stored level and connected to its destination. It belongs to this
 * module: connect into it, never disconnect it.
 */
export function getSpeakersVolumeNode(audioContext: BaseAudioContext = getAudioContext()): GainNode {
  let node = nodes.get(audioContext);
  if (!node) {
    node = createVolumeNode(audioContext, getSpeakersVolume()) as GainNode;
    node.connect(audioContext.destination);
    nodes.set(audioContext, node);
  }
  current = { ctx: audioContext, node };
  return node;
}

/**
 * Set the speakers volume: remembered at once, and ramped over 20 ms on the node (when it exists;
 * one made later starts at this level). Listeners hear the new level. Returns whether a ramp ran.
 */
export function setSpeakersVolume(v01: number): boolean {
  if (typeof v01 !== 'number' || !Number.isFinite(v01)) return false;
  const next = clampVolume(v01);
  const changed = next !== getSpeakersVolume();
  level = next;
  writeVolume(storage(), SPEAKERS_VOLUME_STORAGE_KEY, next);
  const ramped = current ? setVolume(current.node.gain, next, current.ctx) : false;
  if (changed) listeners.forEach((listener) => listener(next));
  return ramped;
}

/** Call `listener` with the new level whenever the speakers volume changes. Returns the unsubscribe. */
export function subscribeSpeakersVolume(listener: (level: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget the cached level and the current node (module state survives isolate:false). */
export function resetSpeakersVolumeForTests(): void {
  level = null;
  current = null;
  listeners.clear();
}
