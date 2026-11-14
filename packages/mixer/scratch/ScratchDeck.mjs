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
import {
  SCRATCH_FEEL_DEFAULTS,
  sanitizeScratchFeel,
  sanitizeScratchSnapGrid,
  scratchSnapSeconds,
} from './scratchPhysics.mjs';

const isDefaultFeel = (feel) =>
  feel.brakeSeconds === SCRATCH_FEEL_DEFAULTS.brakeSeconds &&
  feel.spinUpSeconds === SCRATCH_FEEL_DEFAULTS.spinUpSeconds;

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
    /**
     * Spec 023: the deck's release state as the main thread sees it: `'live'`, `'held'`,
     * `'releasing'` (spinning up, no lag reported yet), `'settled'` (lag reported, hand-over
     * pending in the worklet).
     */
    this._phase = 'live';
    this._releaseId = 0;
    /** The release whose lag was accepted and whose hand-over isn't sent yet (sync mode). */
    this._settledId = null;
    this._lagListeners = new Set();
    this._planListeners = new Set();
    /** The latest release's plan from the worklet (see onPlan). */
    this._plan = null;
    /** Spec 025: the snap grid the lag is rounded to on release (spec 023's "on" is 'beat'). */
    this._snapGrid = 'beat';
    /** Spec 025: the brake and the spin-up, in seconds (the 023 values by default). */
    this._feel = { ...SCRATCH_FEEL_DEFAULTS };
    /** @type {(() => number|undefined)|null} */
    this._tempoSource = null;
  }

  /**
   * Spec 025: the snap grid: `'off' | 'half' | 'beat' | 'bar'`, used from the next release.
   * Anything else (and spec 023's booleans) is mapped by `sanitizeScratchSnapGrid`.
   * @type {'off'|'half'|'beat'|'bar'}
   */
  get snapGrid() {
    return this._snapGrid;
  }

  set snapGrid(grid) {
    this._snapGrid = sanitizeScratchSnapGrid(grid);
  }

  /**
   * Spec 023's Snap to beat switch.
   * @deprecated Since spec 025: use {@link snapGrid}. `true` sets `'beat'`, `false` `'off'`; reads
   *   true unless the grid is `'off'`.
   * @type {boolean}
   */
  get snap() {
    return this._snapGrid !== 'off';
  }

  set snap(on) {
    this._snapGrid = on ? 'beat' : 'off';
  }

  /** Spec 025: the current feel, `{ brakeSeconds, spinUpSeconds }` (a copy). */
  get feel() {
    return { ...this._feel };
  }

  /**
   * Spec 025: set the brake (how long a grabbed record takes to stop, 0.02–1 s) and the spin-up
   * (how long the motor takes to bring a released record to speed, 0.1–2 s). A field left out
   * keeps its current value; an invalid one falls back to its default (0.1 s, 0.4 s). Applies
   * from the next grab or release; a brake or spin-up already running is never cut short.
   * @param {{brakeSeconds?: number, spinUpSeconds?: number}} feel
   * @returns {{brakeSeconds: number, spinUpSeconds: number}} The feel now in use.
   */
  setFeel(feel) {
    const patch = feel && typeof feel === 'object' ? feel : {};
    const next = sanitizeScratchFeel({ ...this._feel, ...patch });
    const changed = next.brakeSeconds !== this._feel.brakeSeconds || next.spinUpSeconds !== this._feel.spinUpSeconds;
    this._feel = next;
    if (changed) this._post({ type: 'feel', ...next });
    return { ...next };
  }

  /** Spec 023: `'live' | 'held' | 'releasing' | 'settled'` (see the constructor). */
  get phase() {
    return this._phase;
  }

  /** The id of the latest release (echoed by the worklet's `lagSettled`). */
  get releaseId() {
    return this._releaseId;
  }

  /**
   * Where the deck reads its tempo (cycles per second) at a release, for snap to beat.
   * @param {(() => number|undefined)|null} fn
   */
  setTempoSource(fn) {
    this._tempoSource = typeof fn === 'function' ? fn : null;
  }

  /**
   * Called when a released record has settled at rate 1, `lagSeconds` behind live (spec 023).
   * The listener shifts the deck's pattern and calls {@link handOver}. A deck without a
   * listener goes back to live by itself.
   * @param {(event: {id: number, lagSeconds: number}) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  onLagSettled(fn) {
    if (typeof fn !== 'function') return () => {};
    this._lagListeners.add(fn);
    return () => this._lagListeners.delete(fn);
  }

  /**
   * The release's plan (spec 023 review 2), once per release, as the worklet will run it:
   * `{ id, targetSeconds, upSeconds, fromRate, bumpSeconds, bumpDepth }`. The platter follows it.
   * @param {(plan: object) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  onPlan(fn) {
    if (typeof fn !== 'function') return () => {};
    this._planListeners.add(fn);
    return () => this._planListeners.delete(fn);
  }

  /** The latest release's plan, or null. */
  get plan() {
    return this._plan;
  }

  /**
   * Whether the hand-over of release `id` may still be sent: its lag was accepted and nothing
   * (a stop, a newer release) has replaced it. A deck grabbed again meanwhile still takes it, so
   * the worklet knows where the shifted input begins.
   * @param {number} id
   */
  canHandOver(id) {
    if (id !== this._releaseId || this._destroyed) return false;
    return this._phase === 'settled' || (this._phase === 'held' && this._settledId === id);
  }

  /**
   * The pattern has been shifted: the worklet crossfades from the record to live (20 ms) at
   * context time `atSeconds`; the shifted live input starts at `shiftSeconds` (default
   * `atSeconds`). Only for release `id`, while {@link canHandOver}.
   * @param {number} id
   * @param {number} atSeconds
   * @param {number} [shiftSeconds]
   */
  handOver(id, atSeconds, shiftSeconds) {
    if (!this.canHandOver(id)) return;
    if (this._phase === 'settled') this._phase = 'live';
    this._settledId = null;
    const msg = { type: 'handOver', id, at: atSeconds };
    if (Number.isFinite(shiftSeconds)) msg.shiftAt = shiftSeconds;
    this._post(msg);
  }

  /**
   * A same-track Update or Ctrl+Enter during the spin-up (spec 023 review 4): apply the planned
   * lag now, as if it had settled, with a quick hand-over, so the track stays where the record
   * is going. Without a plan yet (released a moment ago) the release is cancelled instead; a
   * plan with lag 0 needs no shift and just runs on.
   * @returns {boolean} Whether the release is kept (shifted, or running on to lag 0).
   */
  commitPending() {
    if (this._phase !== 'releasing') return false;
    const plan = this._plan;
    if (!plan || plan.id !== this._releaseId) {
      this.cancelPending();
      return false;
    }
    if (!(plan.targetSeconds > 0)) return true;
    const id = this._releaseId;
    // When the record reaches its lag (re-review 4): the shift and the hand-over wait for it.
    const start = Number.isFinite(plan.startTime) ? plan.startTime : this._releaseTime;
    const settleAt = Number.isFinite(start) ? start + plan.upSeconds + (plan.bumpSeconds || 0) : undefined;
    this._onLagSettled({ id, lagSeconds: plan.targetSeconds, settleAt });
    // A refused shift aborted the release (and moved the id on).
    return this._releaseId === id;
  }

  /**
   * Back to live now (20 ms crossfade), dropping a release in progress: no lag is reported for
   * it any more. Used on stop. A held deck stays held.
   */
  abort() {
    if (!this.node || this._grabbed) return;
    this._releaseId++;
    this._phase = 'live';
    this._settledId = null;
    this._post({ type: 'abort' });
  }

  /**
   * Cancel a release whose lag hasn't been reported yet (spec 023, before a switch or an
   * Update): the deck goes back to live and a late `lagSettled` is ignored, so no stale shift
   * is applied. A settled deck (shift applied, hand-over scheduled in the worklet) completes.
   * @returns {boolean} Whether a release was cancelled.
   */
  cancelPending() {
    if (this._phase !== 'releasing') return false;
    this.abort();
    return true;
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
    // Spec 025: a feel set before the node existed (the worklet starts with the defaults).
    if (!isDefaultFeel(this._feel)) this._post({ type: 'feel', ...this._feel });
    this._emit();
    return true;
  }

  /**
   * Grab the platter: the turning record brakes to a stop (~0.1 s) and the deck crossfades
   * (10 ms) from live to it. No-op when not attached or already held.
   * @returns {boolean} Whether the deck is now held.
   */
  grab() {
    if (!this.node || this._destroyed) return false;
    if (this._grabbed) return true;
    this._grabbed = true;
    // A release still spinning up is taken over by this grab: its lag will not be reported.
    if (this._phase === 'releasing') this._releaseId++;
    // A settled deck whose hand-over isn't sent yet keeps that release (canHandOver).
    if (this._phase !== 'settled') this._settledId = null;
    this._phase = 'held';
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

  /**
   * Let go: the motor spins the record up (~0.4 s, spec 025: the feel's spin-up) and its lag
   * lands on the nearest step of the snap grid, or stays as it is (`'off'`); then the deck reports
   * the lag (see {@link onLagSettled}). Idempotent; safe before attach resolves.
   */
  release() {
    if (!this._grabbed) return;
    this._grabbed = false;
    let beatSeconds = 0;
    if (this._snapGrid !== 'off') {
      let cps;
      try {
        cps = this._tempoSource?.();
      } catch (err) {
        console.warn('[ScratchDeck] reading the tempo failed:', err?.message ?? err);
      }
      beatSeconds = scratchSnapSeconds(this._snapGrid, cps);
    }
    const id = ++this._releaseId;
    this._releaseTime = this.audioContext?.currentTime;
    this._phase = 'releasing';
    this._settledId = null;
    this._plan = null;
    const msg = { type: 'release', id, beatSeconds };
    // Spec 025: the worklet plans with the same spin-up (the default message stays 023's).
    if (this._feel.spinUpSeconds !== SCRATCH_FEEL_DEFAULTS.spinUpSeconds) msg.spinUpSeconds = this._feel.spinUpSeconds;
    this._post(msg);
    this._emit();
  }

  /**
   * Test hook: the worklet's own view, via a port round-trip. Resolves `null` when not attached
   * or when the worklet does not answer within a second.
   * @returns {Promise<{mix: number, grabbed: boolean, pos: number, phase?: string, lag?: number, rate?: number}|null>}
   *   `pos` in seconds (≤ 0), `lag` in seconds, `rate` × normal speed.
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
    this._lagListeners.clear();
    this._planListeners.clear();
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
    if (msg?.type === 'lagSettled') {
      this._onLagSettled(msg);
      return;
    }
    if (msg?.type === 'plan') {
      if (msg.id !== this._releaseId) return;
      this._plan = { ...msg };
      for (const fn of [...this._planListeners]) {
        try {
          fn(this._plan);
        } catch (err) {
          console.error('[ScratchDeck] plan listener failed:', err);
        }
      }
      return;
    }
    if (msg?.type === 'idle') {
      if (msg.id === this._releaseId && this._phase !== 'held') this._phase = 'live';
      return;
    }
    if (msg?.type !== 'debug') return;
    const pending = this._debugPending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this._debugPending.delete(msg.id);
    const { mix, grabbed, pos, phase, lag, rate } = msg;
    pending.resolve({ mix, grabbed, pos, phase, lag, rate });
  }

  /** @private Only the latest, still pending release counts: a cancelled one is ignored. */
  _onLagSettled(msg) {
    if (msg.id !== this._releaseId || this._phase !== 'releasing' || this._destroyed) return;
    this._phase = 'settled';
    this._settledId = msg.id;
    const lagSeconds = Number(msg.lagSeconds);
    if (this._lagListeners.size === 0 || !Number.isFinite(lagSeconds)) {
      this.abort();
      return;
    }
    let accepted = false;
    for (const fn of [...this._lagListeners]) {
      try {
        const event = { id: msg.id, lagSeconds };
        if (Number.isFinite(msg.settleAt)) event.settleAt = msg.settleAt;
        if (fn(event) === true) accepted = true;
      } catch (err) {
        console.error('[ScratchDeck] lagSettled listener failed:', err);
      }
    }
    // Nobody shifted the track (refused, blocked): back to live. A listener that shifted it but
    // learns the arrival time later (sync mode) returns true and hands over then.
    if (this._phase === 'settled' && !accepted) this.abort();
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
