/**
 * Which node a recording takes its sound from (spec 026 Record as heard).
 *
 * Off (the default, spec 008's choice): superdough's destinationGain, before the EQ, so a recording
 * is the track. On: the main EQ's final output (getMainEqualizerOutputTap), after the EQ and its
 * limiter, exactly what the speakers play. When the main EQ is not installed yet (audio not started),
 * the recording falls back to destinationGain and does not fail.
 *
 * The tap is chosen when a recording starts; changing the option mid-recording applies to the next one.
 */
import { getMainEqualizerOutputTap } from '../mainEqualizer';

/** localStorage key of the Record as heard option ('true' / 'false'; absent means off). */
export const RECORD_POST_EQ_KEY = 'strudel-record-post-eq';

/** Whether Record as heard is on (off by default, and when storage cannot be read). */
export function loadRecordPostEq(): boolean {
  try {
    return localStorage.getItem(RECORD_POST_EQ_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remember the Record as heard option on this device. */
export function saveRecordPostEq(on: boolean): void {
  try {
    localStorage.setItem(RECORD_POST_EQ_KEY, on ? 'true' : 'false');
  } catch (err) {
    console.warn('[recording] could not save the Record as heard option:', err);
  }
}

/**
 * The node to record from: the main EQ's output when Record as heard is on and the EQ exists,
 * otherwise destinationGain (null when there is no destinationGain: audio not started).
 * @param destinationGain - superdough's destinationGain (pre-EQ)
 * @param postEq - The Record as heard option (read from storage by default)
 * @param eqTap - The main EQ's output (getMainEqualizerOutputTap by default)
 */
export function selectRecordingTap(
  destinationGain: AudioNode | null | undefined,
  postEq: boolean = loadRecordPostEq(),
  eqTap: AudioNode | null = getMainEqualizerOutputTap(),
): AudioNode | null {
  if (!destinationGain) return null;
  return postEq && eqTap ? eqTap : destinationGain;
}
