/**
 * Which node a recording takes its sound from (spec 026 Record as heard).
 *
 * Off (the default, spec 008's choice): superdough's destinationGain, before the EQ, so a recording
 * is the track. On: the main EQ's final output (getMainEqualizerOutputTap), after the EQ and its
 * limiter, exactly what the speakers play, through a fixed −1 dB trim (openRecordingTap) so the encoded
 * file does not clip; the speakers are not trimmed. When the main EQ is not installed yet (audio not started),
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

/**
 * Record as heard trim (dB): the EQ output peaks just under 0 dBFS (limiter threshold −0.3 dB), and the
 * WebM/Opus encoder overshoots that (+0.15 dBFS measured, spec 026), so the recorded file clipped.
 * Applied on the recording path only; the speakers keep the EQ output as it is.
 */
export const RECORD_POST_EQ_TRIM_DB = -1;

/** RECORD_POST_EQ_TRIM_DB as a linear gain (about 0.891). */
export const RECORD_POST_EQ_TRIM_GAIN = 10 ** (RECORD_POST_EQ_TRIM_DB / 20);

/** A recording's tap: connect a recorder to `node`; call `close()` once the recording has stopped. */
export interface RecordingTap {
  node: AudioNode;
  close: () => void;
}

/**
 * Open the tap a recording takes its sound from (selectRecordingTap's choice). destinationGain is used
 * as it is. The main EQ's output gets a fixed RECORD_POST_EQ_TRIM_DB GainNode of its own (a fan-out
 * beside the speakers' edge), made here and disconnected by `close()`, so nothing is left on the EQ
 * output after the recording. `close()` is idempotent. Null when there is no destinationGain.
 * @param audioContext - The context the tap lives on (the main one)
 * @param destinationGain - superdough's destinationGain (pre-EQ)
 * @param postEq - The Record as heard option (read from storage by default)
 * @param eqTap - The main EQ's output (getMainEqualizerOutputTap by default)
 */
export function openRecordingTap(
  audioContext: BaseAudioContext,
  destinationGain: AudioNode | null | undefined,
  postEq: boolean = loadRecordPostEq(),
  eqTap: AudioNode | null = getMainEqualizerOutputTap(),
): RecordingTap | null {
  const source = selectRecordingTap(destinationGain, postEq, eqTap);
  if (!source) return null;
  if (!eqTap || source !== eqTap) return { node: source, close: () => {} };
  const trim = audioContext.createGain();
  // Set before it is connected to anything: not a jump on an audible path.
  trim.gain.setValueAtTime(RECORD_POST_EQ_TRIM_GAIN, 0);
  eqTap.connect(trim);
  let open = true;
  return {
    node: trim,
    close: () => {
      if (!open) return;
      open = false;
      try {
        eqTap.disconnect(trim);
      } catch {
        // already disconnected
      }
      trim.disconnect();
    },
  };
}
