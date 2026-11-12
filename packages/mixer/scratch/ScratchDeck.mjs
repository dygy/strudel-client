/**
 * ScratchDeck - the main-thread handle on one deck's scratch node (spec 019, tech §2.4).
 *
 * One deck per SuperdoughAudioController (main speakers, headphone preview). `attach()` loads
 * the `scratch-processor` worklet, creates the node and puts it in the controller's pre-gain
 * insert slot (`channelMerger → scratch → destinationGain`). Grab / move / motor / release are
 * port messages; every gain change happens as a sample-accurate ramp inside the worklet.
 *
 * @license AGPL-3.0-or-later
 */

import { loadScratchWorklet, SCRATCH_PROCESSOR } from './scratchWorklet.mjs';

/** Seconds of audio one full platter turn moves (33⅓ rpm). */
export const SCRATCH_SECONDS_PER_TURN = 1.8;
/** Seconds of audio one mouse-wheel notch (deltaY normalised to 100 px) moves. */
export const SCRATCH_WHEEL_SECONDS_PER_NOTCH = 0.06;
/** How far back the record reaches, in seconds. */
export const SCRATCH_BUFFER_SECONDS = 8;
/** Largest motor rate, in × normal speed. */
export const SCRATCH_MAX_MOTOR_RATE = 8;

const DEBUG_TIMEOUT_MS = 1000;

/**
 * The scratch node of one deck.
 *
 * Events (`deck.on('change', fn)`): fired when the deck attaches, is grabbed, released or
 * destroyed. `fn` gets the deck.
 *
 * @example
 * const deck = new ScratchDeck(audioContext, superdoughController);
 * await deck.attach();
 * deck.grab();
 * deck.moveBy(-0.1); // pull back 100 ms of audio
 * deck.release();
 */
export class ScratchDeck {
  /**
   * @param {BaseAudioContext} audioContext - The context the controller's nodes live in.
   * @param {object} controller - A SuperdoughAudioController with `setPreGainInsert(node|null)`.
   */
  constructor(audioContext, controller) {
    this.audioContext = audioContext;
    this.controller = controller;
    /** @type {AudioWorkletNode|null} */
    this.node = null;
    this._grabbed = false;
    this._attaching = null;
    this._destroyed = false;
    this._listeners = new Set();
    this._debugId = 0;
    this._debugPending = new Map();
  }

  /** True once the node is in the controller's insert slot. */
  get isAttached() {
    return this.node !== null;
  }

  /** True while the platter is held. */
  get isGrabbed() {
    return this._grabbed;
  }

  /**
   * Load the worklet (once per context), create the scratch node and insert it before the
   * controller's destination gain. Never rejects: resolves `true` when attached, `false` when
   * the controller has no insert slot, the worklet failed to load, or the deck was destroyed
   * meanwhile (a warning is logged; a later call retries). Repeated calls share one attempt.
   * @returns {Promise<boolean>}
   */
  attach() {
    if (this.node) return Promise.resolve(true);
    if (this._destroyed) return Promise.resolve(false);
    if (this._attaching) return this._attaching;
    this._attaching = this._attach().then(
      (ok) => {
        this._attaching = null;
        return ok;
      },
      (err) => {
        this._attaching = null;
        console.warn('[ScratchDeck] attach failed:', err?.message ?? err);
        return false;
      },
    );
    return this._attaching;
  }

  /** @private */
  async _attach() {
    const controller = this.controller;
    if (typeof controller?.setPreGainInsert !== 'function') {
      console.warn('[ScratchDeck] the audio controller has no setPreGainInsert(); scratch stays un-attached');
      return false;
    }
    const ac = this.audioContext;
    await loadScratchWorklet(ac);
    if (this._destroyed) return false;
    const channelCount = Math.max(1, ac.destination?.channelCount || 2);
    const node = new AudioWorkletNode(ac, SCRATCH_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      outputChannelCount: [channelCount],
      processorOptions: { bufferSeconds: SCRATCH_BUFFER_SECONDS },
    });
    node.port.onmessage = (event) => this._onMessage(event.data);
    try {
      controller.setPreGainInsert(node);
    } catch (err) {
      this._closeNode(node);
      throw err;
    }
    this.node = node;
    this._emit();
    return true;
  }

  /**
   * Grab the platter: the deck crossfades (10 ms) from live to the frozen last 8 seconds,
   * held still. No-op when not attached or already held.
   * @returns {boolean} Whether the deck is now held.
   */
  grab() {
    if (!this.node || this._destroyed) return false;
    if (this._grabbed) return true;
    this._grabbed = true;
    this._post({ type: 'grab' });
    this._emit();
    return true;
  }

  /**
   * Move the held platter by `seconds` of audio (negative = backwards). Ignored unless held,
   * and ignored for non-finite values.
   * @param {number} seconds
   */
  moveBy(seconds) {
    if (!this._grabbed || typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    this._post({ type: 'move', delta: seconds });
  }

  /**
   * Turn the held platter continuously at `rate` × normal speed (±1 = keyboard, 0 = stop).
   * Ignored unless held and for non-finite values; clamped to ±8.
   * @param {number} rate
   */
  setMotor(rate) {
    if (!this._grabbed || typeof rate !== 'number' || !Number.isFinite(rate)) return;
    const clamped = Math.max(-SCRATCH_MAX_MOTOR_RATE, Math.min(SCRATCH_MAX_MOTOR_RATE, rate));
    this._post({ type: 'motor', rate: clamped });
  }

  /** Let go: the deck crossfades (10 ms) back to live, on the beat. Idempotent; safe before attach resolves. */
  release() {
    if (!this._grabbed) return;
    this._grabbed = false;
    this._post({ type: 'release' });
    this._emit();
  }

  /**
   * Test hook: the worklet's own view, via a port round-trip. Resolves `null` when not attached
   * or when the worklet does not answer within a second.
   * @returns {Promise<{mix: number, grabbed: boolean, pos: number}|null>} `pos` in seconds (≤ 0).
   */
  getDebugState() {
    if (!this.node) return Promise.resolve(null);
    const id = ++this._debugId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._debugPending.delete(id);
        resolve(null);
      }, DEBUG_TIMEOUT_MS);
      this._debugPending.set(id, { resolve, timer });
      this._post({ type: 'debug', id });
    });
  }

  /**
   * Subscribe to deck changes.
   * @param {'change'} event
   * @param {(deck: ScratchDeck) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  on(event, fn) {
    if (event !== 'change' || typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Release, clear the controller's insert slot, disconnect the node and close its port. */
  destroy() {
    if (this._destroyed) return;
    this.release();
    this._destroyed = true;
    const node = this.node;
    this.node = null;
    if (node) {
      try {
        const controller = this.controller;
        // Clear the slot only while it still holds this node (never another deck's).
        const current = typeof controller?.getPreGainInsert === 'function' ? controller.getPreGainInsert() : node;
        if (current === node) controller?.setPreGainInsert?.(null);
      } catch (err) {
        console.warn('[ScratchDeck] clearing the insert slot failed:', err?.message ?? err);
      }
      this._closeNode(node);
    }
    for (const { resolve, timer } of this._debugPending.values()) {
      clearTimeout(timer);
      resolve(null);
    }
    this._debugPending.clear();
    this._emit();
    this._listeners.clear();
  }

  /** @private */
  _closeNode(node) {
    try {
      node.disconnect();
    } catch {
      /* not connected */
    }
    if (node.port) {
      node.port.onmessage = null;
      node.port.close?.();
    }
  }

  /** @private */
  _post(msg) {
    this.node?.port?.postMessage(msg);
  }

  /** @private */
  _onMessage(msg) {
    if (msg?.type !== 'debug') return;
    const pending = this._debugPending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._debugPending.delete(msg.id);
    pending.resolve({ mix: msg.mix, grabbed: msg.grabbed, pos: msg.pos });
  }

  /** @private */
  _emit() {
    for (const fn of [...this._listeners]) {
      try {
        fn(this);
      } catch (err) {
        console.error('[ScratchDeck] change listener failed:', err);
      }
    }
  }
}
