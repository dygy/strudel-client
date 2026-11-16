/**
 * The headphones volume for the UI and MIDI (spec 031 §2.4): the level lives in the PreviewEngine
 * (`setVolume` ramps over 20 ms and remembers it); this module only tells the on-screen slider when
 * MIDI changed it, as speakersVolume.ts does for the speakers.
 */
export interface HeadphonesVolumeEngine {
  getVolume(): number;
  setVolume(v01: number): boolean;
}

const listeners = new Set<(level: number) => void>();

/** The engine's level, or 1 (unity) without an engine. */
export function getHeadphonesVolume(engine: HeadphonesVolumeEngine | null | undefined): number {
  const level = engine?.getVolume?.();
  return typeof level === 'number' && Number.isFinite(level) ? level : 1;
}

/** Set the headphones volume on `engine` and tell the listeners. False without an engine. */
export function setHeadphonesVolume(engine: HeadphonesVolumeEngine | null | undefined, v01: number): boolean {
  if (!engine?.setVolume || typeof v01 !== 'number' || !Number.isFinite(v01)) return false;
  const before = getHeadphonesVolume(engine);
  const ramped = engine.setVolume(v01);
  const after = getHeadphonesVolume(engine);
  if (after !== before) listeners.forEach((listener) => listener(after));
  return ramped;
}

/** Hear every change made through setHeadphonesVolume. Returns the unsubscribe. */
export function subscribeHeadphonesVolume(listener: (level: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetHeadphonesVolumeForTests(): void {
  listeners.clear();
}
