/**
 * The main (speakers) EQ, spec 008 Req 2.2: one AudioEqualizer on the main AudioContext,
 *
 *   superdough channelMerger → destinationGain → [EQ input … EQ output] → audioContext.destination
 *
 * installed through superdough's output insert (SuperdoughAudioController.setOutputInsert), so it
 * survives resetGlobalEffects() rebuilding destinationGain. Recorders and track transitions tap
 * destinationGain, so recordings stay pre-EQ (the EQ is monitoring, like a player EQ).
 *
 * When: only after superdough's `initAudio` has run (installMainEqualizerWhenReady(audioReady)).
 * Creating the global controller sizes its channel merger and destination.channelCount for the
 * output device, so it must wait until initAudio has applied the chosen device (setSinkId);
 * otherwise multiChannelOrbits on a >2-channel interface would be sized for the default device.
 *
 * Shared: useReplContext is mounted more than once at the same time, so the EQ is reference-counted
 * (initMainEqualizer acquires, releaseMainEqualizer releases) and removed with the last release.
 *
 * The saved settings are applied when it is created (setEnabled before setBand), so the EQ is heard
 * without opening the settings panel, and panel changes made before it existed (saved by the
 * panel) are picked up. The panel re-renders when it appears (subscribeMainEqualizer).
 *
 * Channels: the EQ's nodes keep the default 'max' channel count mode, so a multichannel merger
 * (multiChannelOrbits) passes through without a downmix; its limiter stage is sized per stereo pair
 * and resized when superdough's output reset changes the channel count (spec 020).
 *
 * Latency (spec 020): the EQ delays the speakers by its limiter look-ahead (LIMITER.lookahead, 6 ms),
 * on and off alike. The MIDI default latency includes it. Sound written by `.dough()` / the dsp
 * worklet goes straight to the destination, skips the EQ, and so plays 6 ms early relative to
 * superdough's sounds.
 */
import { AudioEqualizer, applyEqualizerSettings, loadEqualizerSettings } from '@strudel/equalizer';
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';

/** What the main EQ needs from superdough's controller (SuperdoughAudioController). */
export interface OutputInsertHost {
  /**
   * Returns the seconds until the previous target is silent (superdough fades the swap, spec 020);
   * `onChannelCount` is called when superdough's output reset changes the channel count.
   */
  setOutputInsert(node: AudioNode | null, options?: { onChannelCount?: (channelCount: number) => void }): number | void;
}

let mainEqualizer: AudioEqualizer | null = null;
let installedOn: OutputInsertHost | null = null;
let installedContext: AudioContext | null = null;
let references = 0;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/**
 * Acquire the main EQ: create it on first use (saved settings applied, put between superdough's
 * output and the speakers), otherwise return the existing one. Every call must be paired with a
 * releaseMainEqualizer(). Defaults to the global context and controller the app plays through.
 */
export function initMainEqualizer(
  audioContext: AudioContext = getAudioContext(),
  controller: OutputInsertHost = getSuperdoughAudioController(),
): AudioEqualizer {
  references++;
  if (mainEqualizer && installedOn === controller && installedContext === audioContext) {
    return mainEqualizer;
  }
  teardown();

  const eq = new AudioEqualizer(audioContext);
  const saved = loadEqualizerSettings();
  if (saved) {
    applyEqualizerSettings(eq, saved); // on/off first, then each band: saved-as-off stays silent
  }
  eq.getOutput().connect(audioContext.destination);
  // The limiter stage follows the output's channel count when superdough's output reset changes it
  // (spec 020), so a multichannel output is never downmixed in the wet path.
  controller.setOutputInsert(eq.getInput(), { onChannelCount: (channels) => eq.setChannelCount(channels) });

  mainEqualizer = eq;
  installedOn = controller;
  installedContext = audioContext;
  notify();
  return eq;
}

/** Release one reference; the last release restores the destination and disconnects the EQ. */
export function releaseMainEqualizer(): void {
  if (references === 0) return;
  references--;
  if (references === 0) {
    teardown();
    notify();
  }
}

/**
 * Install the main EQ once `ready` (superdough's audioReady from initAudioOnFirstClick) resolves.
 * Call it at mount, before any evaluate awaits the same promise, so the EQ is in place before the
 * first note. Returns the release for unmount: before `ready` resolves it cancels the install.
 */
export function installMainEqualizerWhenReady(
  ready: Promise<unknown> | undefined,
  init: () => unknown = () => initMainEqualizer(),
): () => void {
  let cancelled = false;
  let acquired = false;
  Promise.resolve(ready)
    .then(() => {
      if (cancelled) return;
      init();
      acquired = true;
    })
    .catch((err) => console.error('Failed to initialize the main equalizer:', err));
  return () => {
    if (cancelled) return;
    cancelled = true;
    if (acquired) releaseMainEqualizer();
  };
}

/** The main (speakers) EQ, or null before it is installed / after the last release. */
export function getMainEqualizer(): AudioEqualizer | null {
  return mainEqualizer;
}

/** Call `listener` whenever the main EQ appears or goes away. Returns the unsubscribe. */
export function subscribeMainEqualizer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remove the main EQ whatever the reference count (tests, hot reload). */
export function destroyMainEqualizer(): void {
  references = 0;
  const had = mainEqualizer !== null;
  teardown();
  if (had) notify();
}

function teardown(): void {
  let fade = 0;
  if (installedOn) {
    try {
      fade = Number(installedOn.setOutputInsert(null)) || 0;
    } catch (err) {
      console.warn('[mainEqualizer] could not restore the output:', err);
    }
  }
  // superdough fades the EQ path out (spec 020): disconnect the EQ once it is silent, not mid-fade.
  const eq = mainEqualizer;
  if (eq && fade > 0) setTimeout(() => eq.destroy(), (fade + 0.02) * 1000);
  else eq?.destroy();
  mainEqualizer = null;
  installedOn = null;
  installedContext = null;
}
