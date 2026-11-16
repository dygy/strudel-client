/**
 * beatRepeatCore.mjs - the beat-repeat (roll) DSP, pure (spec 032 functional §2.4, tech §2.2).
 *
 * No Web Audio, DOM or browser globals: it runs inside the `beat-repeat-processor` AudioWorklet
 * and in Node tests on plain Float32Arrays.
 *
 * Every input frame is written to an N-channel ring of `ringSeconds` (8 s), keyed by the absolute
 * frame number (the worklet's `currentFrame`), so main-thread context times convert to frames.
 *
 * - **Idle**: the output is the input, sample for sample, with no latency.
 * - **Roll** `{ startFrame, lengthFrames }`: while `frame < startFrame + lengthFrames` the output
 *   stays live (the slice is still being played by the track); after that it plays the slice
 *   `[startFrame, startFrame + lengthFrames)` over and over, phase-locked to the start:
 *   `slice[(frame − startFrame) mod lengthFrames]`. Each wrap is an equal-power crossfade of
 *   `fadeSeconds` (3 ms) from what would follow the slice to its head; on the first wrap that is the
 *   live input, so the roll's start is the same crossfade.
 * - **Length** `{ lengthFrames }`: applies at the next wrap.
 * - **Stop**: an equal-power crossfade back to live. The input was written all along (the slip), so
 *   live resumes where the track is.
 * - A new roll during a roll crossfades from the old loop.
 *
 * A held roll may outlast the ring: each roll copies its slice into its own buffer as it is heard
 * (live frames as they pass; earlier ones on first read), so the ring can be overwritten safely.
 * A slice is at most half the ring. A start older than the ring allows is clamped to the oldest
 * usable frame; a start in the future is treated as now.
 *
 * @license AGPL-3.0-or-later
 */

/** Seconds of input kept for look-back. */
export const BEAT_REPEAT_RING_SECONDS = 8;
/** Seconds of each equal-power crossfade (loop wraps, start, stop). */
export const BEAT_REPEAT_FADE_SECONDS = 0.003;
/** The shortest slice, in frames. */
export const BEAT_REPEAT_MIN_LENGTH_FRAMES = 128;

const HALF_PI = Math.PI / 2;

/**
 * @typedef {object} RollVoice
 * @property {number} start - Absolute frame of the slice's first sample.
 * @property {number} pressFrame - Frame the roll was pressed at (offsets before it come from the ring).
 * @property {number} len - Length of the pass being played.
 * @property {number} prevLen - Length of the pass before (the wrap crossfade reads past its end).
 * @property {number|null} nextLen - Length for the next pass.
 * @property {number} pos - Offset in the current pass (once looping).
 * @property {boolean} looping - False during the first, live pass.
 * @property {Float32Array[]} buf - The slice (and a little after), per channel.
 * @property {Uint8Array} filled - 1 for the offsets of `buf` already written (every channel).
 */

/**
 * @typedef {object} RollState
 * @property {number} channels
 * @property {number} sampleRate
 * @property {number} size - Ring frames.
 * @property {number} cap - Most frames a voice buffer holds (half the ring + one fade).
 * @property {number} fade - Crossfade frames.
 * @property {Float32Array[]} ring
 * @property {number} frame - Absolute frame of the next sample to process.
 * @property {RollVoice|null} voice - The roll playing, or null (live).
 * @property {{voice: (RollVoice|null), pos: number}|null} fading - What the output fades from.
 * @property {Array<{buf: Float32Array[], filled: Uint8Array}>} pool - Two voice buffers.
 */

/**
 * @param {object} [options]
 * @param {number} [options.channels] - Default 2.
 * @param {number} [options.sampleRate] - Default 48000.
 * @param {number} [options.ringSeconds] - Default {@link BEAT_REPEAT_RING_SECONDS}.
 * @param {number} [options.fadeSeconds] - Default {@link BEAT_REPEAT_FADE_SECONDS}.
 * @returns {RollState}
 */
export function createRollState({
  channels = 2,
  sampleRate = 48000,
  ringSeconds = BEAT_REPEAT_RING_SECONDS,
  fadeSeconds = BEAT_REPEAT_FADE_SECONDS,
} = {}) {
  const n = Math.max(1, Math.floor(channels) || 1);
  const size = Math.max(4 * BEAT_REPEAT_MIN_LENGTH_FRAMES, Math.round(ringSeconds * sampleRate));
  const fade = Math.max(1, Math.round(fadeSeconds * sampleRate));
  const cap = Math.floor(size / 2) + fade;
  const makeBuf = () => ({
    buf: Array.from({ length: n }, () => new Float32Array(cap)),
    filled: new Uint8Array(cap),
  });
  return {
    channels: n,
    sampleRate,
    size,
    cap,
    fade,
    ring: Array.from({ length: n }, () => new Float32Array(size)),
    frame: 0,
    voice: null,
    fading: null,
    pool: [makeBuf(), makeBuf()],
  };
}

/** A slice length in frames, kept between the minimum and half the ring. */
function clampLength(state, lengthFrames) {
  const max = Math.floor(state.size / 2);
  const len = Math.round(Number(lengthFrames));
  if (!Number.isFinite(len)) return null;
  return Math.min(max, Math.max(BEAT_REPEAT_MIN_LENGTH_FRAMES, len));
}

/**
 * Start a roll (or restart it). Takes effect at `state.frame` (the next block).
 * @param {RollState} state
 * @param {number} startFrame - Absolute frame of the slice's first sample (a grid line).
 * @param {number} lengthFrames - Slice length.
 * @returns {boolean} false when the arguments are junk (nothing changes).
 */
export function rollStart(state, startFrame, lengthFrames) {
  const len = clampLength(state, lengthFrames);
  if (len === null || !Number.isFinite(Number(startFrame))) return false;
  const now = state.frame;
  const oldest = now - (state.size - state.cap - BEAT_REPEAT_MIN_LENGTH_FRAMES);
  const start = Math.min(now, Math.max(oldest, Math.round(Number(startFrame))));
  // A buffer no voice uses; with both in use, the one a fading-out voice has (that fade is replaced).
  const used = [state.voice?.buf, state.fading?.voice?.buf];
  const slot = state.pool.find((s) => !used.includes(s.buf)) ?? state.pool.find((s) => s.buf !== state.voice?.buf);
  slot.filled.fill(0);
  const offset = now - start;
  /** @type {RollVoice} */
  const voice = {
    start,
    pressFrame: now,
    len,
    prevLen: len,
    nextLen: null,
    pos: offset >= len ? offset % len : 0,
    looping: offset >= len,
    buf: slot.buf,
    filled: slot.filled,
  };
  const previous = state.voice;
  state.voice = voice;
  if (previous) {
    state.fading = { voice: previous, pos: 0 }; // from the old loop
  } else if (state.fading) {
    // A stop's crossfade still runs: it goes on, now towards the new roll.
  } else if (voice.looping) {
    state.fading = { voice: null, pos: 0 }; // pressed past the slice's first pass: from live
  } else {
    state.fading = null; // the first wrap's crossfade starts the loop
  }
  return true;
}

/**
 * Change the slice length; it applies at the next wrap (during the first pass: to that pass).
 * @param {RollState} state
 * @param {number} lengthFrames
 * @returns {boolean}
 */
export function rollLength(state, lengthFrames) {
  const len = clampLength(state, lengthFrames);
  const voice = state.voice;
  if (len === null || !voice) return false;
  if (!voice.looping) {
    voice.len = len;
    voice.prevLen = len;
    // A shorter first pass that is already over starts looping, phase-locked.
    const offset = state.frame - voice.start;
    if (offset >= len) {
      voice.looping = true;
      voice.pos = offset % len;
      state.fading = { voice: null, pos: 0 };
    }
  } else {
    voice.nextLen = len;
  }
  return true;
}

/**
 * Back to live: an equal-power crossfade from the loop.
 * @param {RollState} state
 */
export function rollStop(state) {
  const voice = state.voice;
  if (!voice) return;
  state.voice = null;
  // Still in the first pass, the output is live already.
  state.fading = voice.looping ? { voice, pos: 0 } : state.fading?.voice ? state.fading : null;
}

/** True while a roll is held (live first pass included) or a crossfade runs. */
export function rollActive(state) {
  return !!(state.voice || state.fading);
}

/** Ring index of absolute frame `f`. */
function ringIndex(state, f) {
  return ((f % state.size) + state.size) % state.size;
}

/** Slice sample `k` (offset from the voice's start) of channel `c`; the first read copies frame `k` from the ring. */
function sliceSample(state, voice, c, k) {
  if (k >= state.cap) return state.ring[c][ringIndex(state, voice.start + k)];
  if (!voice.filled[k]) {
    const r = ringIndex(state, voice.start + k);
    for (let ch = 0; ch < state.channels; ch++) voice.buf[ch][k] = state.ring[ch][r];
    voice.filled[k] = 1;
  }
  return voice.buf[c][k];
}

/**
 * One output sample of `voice` at frame `f` on channel `c` (the live input `live` during its first
 * pass). Does not advance the voice.
 */
function voiceSample(state, voice, c, f, live) {
  if (!voice.looping) return live;
  const pos = voice.pos;
  const head = sliceSample(state, voice, c, pos);
  if (pos >= state.fade) return head;
  const g = (pos / state.fade) * HALF_PI;
  return head * Math.sin(g) + sliceSample(state, voice, c, voice.prevLen + pos) * Math.cos(g);
}

/** Advance `voice` past frame `f` (after every channel of `f` was read). */
function advanceVoice(state, voice, f) {
  if (!voice.looping) {
    if (f + 1 - voice.start >= voice.len) {
      voice.looping = true;
      voice.pos = 0;
      voice.prevLen = voice.len;
    }
    return;
  }
  voice.pos++;
  if (voice.pos >= voice.len) {
    voice.prevLen = voice.len;
    if (voice.nextLen !== null) {
      voice.len = voice.nextLen;
      voice.nextLen = null;
    }
    voice.pos = 0;
  }
}

/**
 * Process one block: write the input to the ring and fill the output.
 * @param {RollState} state
 * @param {Float32Array[]} input - Per channel (missing channels, or no input, are silence).
 * @param {Float32Array[]} output - Per channel, all the same length.
 * @param {number} [startFrame] - Absolute frame of the block's first sample (the worklet's
 *   `currentFrame`); default `state.frame`.
 */
export function processBlock(state, input, output, startFrame) {
  const frames = output?.[0]?.length ?? 0;
  if (!frames) return;
  if (Number.isFinite(startFrame)) state.frame = startFrame;
  const f0 = state.frame;
  const n = Math.min(state.channels, output.length);
  const size = state.size;
  // Write the input to the ring (always: the slip).
  for (let c = 0; c < state.channels; c++) {
    const src = input?.[c];
    const ring = state.ring[c];
    for (let i = 0; i < frames; i++) {
      ring[(f0 + i) % size] = src ? src[i] : 0;
    }
  }
  if (!state.voice && !state.fading) {
    // Idle: an exact copy.
    for (let c = 0; c < output.length; c++) {
      const src = input?.[c];
      if (src && src.length === frames) output[c].set(src);
      else output[c].fill(0);
    }
    state.frame = f0 + frames;
    return;
  }
  const voice = state.voice;
  let fading = state.fading;
  for (let i = 0; i < frames; i++) {
    const f = f0 + i;
    // A voice keeps the live frames of its slice (and what follows) as they pass.
    for (const v of [voice, fading?.voice]) {
      if (!v) continue;
      const k = f - v.start;
      if (k >= 0 && k < state.cap) {
        for (let c = 0; c < state.channels; c++) v.buf[c][k] = input?.[c]?.[i] ?? 0;
        v.filled[k] = 1;
      }
    }
    let gIn = 1;
    let gOut = 0;
    if (fading) {
      const g = (fading.pos / state.fade) * HALF_PI;
      gIn = Math.sin(g);
      gOut = Math.cos(g);
    }
    for (let c = 0; c < n; c++) {
      const live = input?.[c]?.[i] ?? 0;
      const now = voice ? voiceSample(state, voice, c, f, live) : live;
      if (fading) {
        const from = fading.voice ? voiceSample(state, fading.voice, c, f, live) : live;
        output[c][i] = now * gIn + from * gOut;
      } else {
        output[c][i] = now;
      }
    }
    if (voice) advanceVoice(state, voice, f);
    if (fading) {
      if (fading.voice) advanceVoice(state, fading.voice, f);
      fading.pos++;
      if (fading.pos >= state.fade) {
        state.fading = null;
        fading = null;
      }
    }
  }
  for (let c = n; c < output.length; c++) output[c].fill(0);
  state.frame = f0 + frames;
}
