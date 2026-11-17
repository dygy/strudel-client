/**
 * LoudnessMeter.mjs - the node owner of the loudness meter (spec 033 tech §2.1): `LufsMeter`.
 *
 * Named `LufsMeter`, not `LoudnessMeter`: `@strudel/mixer` already exports a `LoudnessMeter` (the
 * spec 017 match-loudness tap, transitions/loudness.mjs), and that public name stays as it is.
 *
 * It makes one `loudness-meter-processor` AudioWorkletNode (2 explicit stereo inputs, no outputs)
 * and connects passive fan-out edges into it:
 *
 *   postEq ──(output 0 → input 0)──▶ ┐
 *                                    ├─ loudness-meter-processor (feeds nothing)
 *   preLimiter ─(output 0 → input 1)▶ ┘
 *
 * Nothing is put on the speakers' path, so attaching, re-attaching, resetting or destroying is
 * silent. Every edge it removes is removed by explicit destination and input
 * (`source.disconnect(node, 0, input)`), never by a bare `disconnect()` on a node it does not own,
 * so the sources' own connections (e.g. the EQ output → speakers volume) survive.
 *
 * @license AGPL-3.0-or-later
 */

import { loadLoudnessWorklet, LOUDNESS_PROCESSOR } from './loudnessLoader.mjs';

/** The processor's node options: 2 inputs, both explicitly stereo with speaker mixing; no outputs. */
export const LUFS_METER_NODE_OPTIONS = Object.freeze({
  numberOfInputs: 2,
  numberOfOutputs: 0,
  channelCount: 2,
  channelCountMode: 'explicit',
  channelInterpretation: 'speakers',
});

/** The meter's inputs: 0 = post-EQ (what is measured), 1 = the EQ limiter's input. */
export const LUFS_METER_INPUTS = Object.freeze({ postEq: 0, preLimiter: 1 });

/**
 * @typedef {import('./loudnessCore.mjs').LoudnessSnapshot} LoudnessSnapshot
 */

/**
 * The loudness meter on one AudioContext. Make it with `await LufsMeter.create(ctx)`, point it at
 * the signals with `attach`, read `onSnapshot` / `getSnapshot`, and `destroy()` it when done.
 */
export class LufsMeter {
  /**
   * Load the worklet (once per context) and make the meter node. Rejects when the worklet cannot be
   * loaded; a later call retries.
   * @param {BaseAudioContext} audioContext
   * @param {{ load?: (ctx: BaseAudioContext) => Promise<void> }} [options] - `load` replaces the
   *   worklet loader (tests)
   * @returns {Promise<LufsMeter>}
   */
  static async create(audioContext, { load = loadLoudnessWorklet } = {}) {
    await load(audioContext);
    const node = new globalThis.AudioWorkletNode(audioContext, LOUDNESS_PROCESSOR, { ...LUFS_METER_NODE_OPTIONS });
    return new LufsMeter(audioContext, node);
  }

  /**
   * Use `LufsMeter.create`; the constructor takes an already made processor node.
   * @param {BaseAudioContext} audioContext
   * @param {AudioWorkletNode} node
   */
  constructor(audioContext, node) {
    this.audioContext = audioContext;
    this.node = node;
    /** @type {Array<{ source: AudioNode, input: number }>} the edges this meter made */
    this.edges = [];
    /** @type {Set<(snapshot: LoudnessSnapshot) => void>} */
    this.listeners = new Set();
    /** @type {LoudnessSnapshot|null} */
    this.latest = null;
    this.destroyed = false;
    node.port.onmessage = (event) => this.handleMessage(event?.data);
  }

  /** @private */
  handleMessage(msg) {
    if (this.destroyed || !msg || msg.type !== 'snapshot') return;
    this.latest = msg.snapshot;
    for (const listener of [...this.listeners]) {
      try {
        listener(msg.snapshot);
      } catch (err) {
        console.warn('[LufsMeter] snapshot listener failed:', err);
      }
    }
  }

  /**
   * Point the meter at its signals. `postEq` feeds input 0 (measured), `preLimiter` input 1 (the
   * `limiter` reason; pass null while the EQ is off, then `clip` watches `postEq`). Calling it again
   * disconnects exactly the edges that changed and connects the new ones; unchanged edges are kept.
   * Pass nulls (or call `detach`) to disconnect both. Silent: the edges are fan-outs.
   * @param {{ postEq?: AudioNode|null, preLimiter?: AudioNode|null }} [sources]
   * @returns {boolean} false once destroyed
   */
  attach({ postEq = null, preLimiter = null } = {}) {
    if (this.destroyed) return false;
    const wanted = [];
    if (postEq) wanted.push({ source: postEq, input: LUFS_METER_INPUTS.postEq });
    if (preLimiter) wanted.push({ source: preLimiter, input: LUFS_METER_INPUTS.preLimiter });
    const same = (a, b) => a.source === b.source && a.input === b.input;
    for (const edge of this.edges) {
      if (!wanted.some((w) => same(w, edge))) this.disconnectEdge(edge);
    }
    const kept = this.edges.filter((edge) => wanted.some((w) => same(w, edge)));
    for (const edge of wanted) {
      if (kept.some((k) => same(k, edge))) continue;
      edge.source.connect(this.node, 0, edge.input);
      kept.push(edge);
    }
    this.edges = kept;
    return true;
  }

  /** Disconnect both inputs (the meter then measures silence). */
  detach() {
    this.attach({});
  }

  /** @private Remove one of this meter's edges, by explicit destination and input. */
  disconnectEdge({ source, input }) {
    try {
      source.disconnect(this.node, 0, input);
    } catch {
      // Already gone: the source was rebuilt or disconnected by its owner.
    }
  }

  /** The nodes now feeding the meter (diagnostics, tests). */
  getSources() {
    const find = (input) => this.edges.find((e) => e.input === input)?.source ?? null;
    return { postEq: find(LUFS_METER_INPUTS.postEq), preLimiter: find(LUFS_METER_INPUTS.preLimiter) };
  }

  /** Clear the measurement (Integrated, true peak, LRA, events, windows); measuring continues. */
  reset() {
    if (this.destroyed) return;
    this.latest = null;
    this.node.port.postMessage({ type: 'reset' });
  }

  /**
   * Listen for snapshots (about every 100 ms while the context runs).
   * @param {(snapshot: LoudnessSnapshot) => void} listener
   * @returns {() => void} unsubscribe
   */
  onSnapshot(listener) {
    if (this.destroyed || typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The latest snapshot, or null before the first one (and after `reset`). */
  getSnapshot() {
    return this.latest;
  }

  /**
   * Disconnect the edges this meter made (only those), stop the processor and close its port.
   * Idempotent.
   */
  destroy() {
    if (this.destroyed) return;
    for (const edge of this.edges) this.disconnectEdge(edge);
    this.edges = [];
    this.listeners.clear();
    this.destroyed = true;
    try {
      this.node.port.postMessage({ type: 'dispose' });
    } catch {
      // port already closed
    }
    this.node.port.onmessage = null;
    this.node.port.close?.();
  }
}
