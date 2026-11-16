/**
 * The one place the website touches the Master FX audio stage (spec 032 tech §2.2) and superdough's
 * master insert slot (tech §2.1). Everything else (the runtime, the UI, the MIDI targets) goes
 * through this adapter, so a rename in @strudel/mixer or superdough is a one-file change here, and
 * tests mock this module instead of Web Audio.
 */
import { MasterFx } from '@strudel/mixer';

/** What the website uses of the MasterFx stage (packages/mixer/masterfx/MasterFx.mjs). */
export interface MasterFxLike {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** −100 (low-pass) … 0 (off, ±3 dead zone) … +100 (high-pass); glides. */
  setFilter(position: number): void;
  /** 0..1. */
  setResonance(r01: number): void;
  setDelay(settings: { fraction: number; feedback: number; level: number }): void;
  setReverb(settings: { decay: number; level: number }): void;
  /** The delay time follows the tempo (glides). */
  setCps(cps: number): void;
  throwDelay(on: boolean): void;
  throwReverb(on: boolean): void;
  /**
   * Start a roll from `startTime` (AudioContext seconds) of `length` seconds, or stop it (null). The
   * stage returns false until its worklet has loaded (then a roll is a no-op).
   */
  roll(options: { startTime: number; length: number } | null): boolean | void;
  /** A held roll's new slice length (seconds), from the next repeat; false before the worklet. */
  setRollLength(seconds: number): boolean | void;
  /** Close both sends and fade the tails out (Stop). */
  stopTails(): void;
  setChannelCount(channelCount: number): void;
  destroy(): void;
}

/** What the runtime needs of superdough's controller (SuperdoughAudioController, fork addition). */
export interface MasterInsertHost {
  setMasterInsert(
    node: AudioNode | null,
    options?: { output?: AudioNode; onChannelCount?: (channelCount: number) => void },
  ): unknown;
}

/** Create the stage on `audioContext` (the main, speakers context). */
export function createMasterFx(audioContext: AudioContext, options: { channelCount: number }): MasterFxLike {
  return new MasterFx(audioContext, { channelCount: options.channelCount }) as MasterFxLike;
}

/** Put the stage between superdough's scratch slot and destinationGain (null takes it out). */
export function setMasterInsert(host: MasterInsertHost, fx: MasterFxLike | null, onChannelCount?: (n: number) => void) {
  if (!fx) return host.setMasterInsert(null);
  return host.setMasterInsert(fx.input, { output: fx.output, onChannelCount });
}
