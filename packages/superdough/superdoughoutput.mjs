import { effectSend, getWorklet, webAudioTimeout } from './helpers.mjs';
import { errorLogger } from './logger.mjs';
import { clamp } from './util.mjs';

let hasChanged = (now, before) => now !== undefined && now !== before;

export class Orbit {
  reverbNode;
  delayNode;
  output;
  summingNode;
  djfNode;
  audioContext;
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.output = new GainNode(audioContext, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.summingNode = new GainNode(audioContext, { gain: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.summingNode.connect(this.output);
  }

  disconnect() {
    this.output.disconnect();
    this.summingNode.disconnect();
    this.delayNode?.disconnect();
    this.reverbNode?.disconnect();
  }

  getDjf(value, t = 0) {
    if (this.djfNode == null) {
      this.djfNode = getWorklet(this.audioContext, 'djf-processor', { value });
      this.summingNode.disconnect();
      this.summingNode.connect(this.djfNode);
      this.djfNode.connect(this.output);
    }
    const val = this.djfNode.parameters.get('value');
    val.setValueAtTime(value, t);
  }

  getDelay(delaytime = 0, feedback = 0.5, t) {
    const maxfeedback = 0.98;
    if (feedback > maxfeedback) {
      //logger(`feedback was clamped to ${maxfeedback} to save your ears`);
    }
    feedback = clamp(feedback, 0, 0.98);
    if (this.delayNode == null) {
      this.delayNode = this.audioContext.createFeedbackDelay(1, delaytime, feedback);
      this.delayNode.connect(this.summingNode);
      this.delayNode.start?.(t); // for some reason, this throws when audion extension is installed..
    }
    this.delayNode.delayTime.value !== delaytime && this.delayNode.delayTime.setValueAtTime(delaytime, t);
    this.delayNode.feedback.value !== feedback && this.delayNode.feedback.setValueAtTime(feedback, t);
    return this.delayNode;
  }

  getReverb(duration, fade, lp, dim, ir, irspeed, irbegin) {
    // If no reverb has been created for a given orbit, create one
    if (this.reverbNode == null) {
      this.reverbNode = this.audioContext.createReverb(duration, fade, lp, dim, ir, irspeed, irbegin);
      this.reverbNode.connect(this.summingNode);
    }

    if (
      hasChanged(duration, this.reverbNode.duration) ||
      hasChanged(fade, this.reverbNode.fade) ||
      hasChanged(lp, this.reverbNode.lp) ||
      hasChanged(dim, this.reverbNode.dim) ||
      hasChanged(irspeed, this.reverbNode.irspeed) ||
      hasChanged(irbegin, this.reverbNode.irbegin) ||
      this.reverbNode.ir !== ir
    ) {
      // only regenerate when something has changed
      // avoids endless regeneration on things like
      // stack(s("a"), s("b").rsize(8)).room(.5)
      // this only works when args may stay undefined until here
      // setting default values breaks this
      this.reverbNode.generate(duration, fade, lp, dim, ir, irspeed, irbegin);
    }
    return this.reverbNode;
  }
  sendReverb(node, amount) {
    effectSend(node, this.reverbNode, amount);
  }

  sendDelay(node, amount) {
    effectSend(node, this.delayNode, amount);
  }

  duck(t, onsettime = 0, attacktime = 0.1, depth = 1) {
    const onset = onsettime;
    const attack = Math.max(attacktime, 0.002);
    const gainParam = this.output.gain;
    webAudioTimeout(
      this.audioContext,
      () => {
        const now = this.audioContext.currentTime;

        // cancelScheduledValues and setValueAtTime together emulate cancelAndHoldAtTime
        // on browsers which lack that method
        const currVal = gainParam.value;
        gainParam.cancelScheduledValues(now);
        gainParam.setValueAtTime(currVal, now);

        const t0 = Math.max(t, now); // guard against now > t
        const duckedVal = clamp(1 - Math.sqrt(depth), 0.01, currVal);
        gainParam.exponentialRampToValueAtTime(duckedVal, t0 + onset);
        gainParam.exponentialRampToValueAtTime(1, t0 + onset + attack);
      },
      0,
      t - 0.01,
    );
  }

  connectToOutput(node) {
    node.connect(this.summingNode);
  }
}

/**
 * Fork addition (strudel-client spec 020). Seconds each half of an output-insert swap takes: the
 * audible path fades out over this time, then the new one fades in over the same time. The direct
 * path and an insert (the main EQ, 6 ms look-ahead) are not time-aligned, so an instant switch
 * would jump by 6 ms (a click); a short dip does not.
 */
export const OUTPUT_INSERT_FADE_TIME = 0.01;

export class SuperdoughOutput {
  channelMerger;
  destinationGain;
  // fork addition (strudel-client spec 008): where destinationGain plays into instead of
  // audioContext.destination (e.g. the main EQ). Kept across reset() / initializeAudio().
  outputInsert = null;
  // fork addition (strudel-client spec 020): options given with the insert (onChannelCount).
  outputInsertOptions = null;
  // fork addition (spec 020): target node → the switch GainNode between destinationGain and it,
  // only while an insert swap fades. At rest it is empty and destinationGain has a bare edge into
  // the insert or the destination, as before.
  outputSwitches = new Map();
  // fork addition (strudel-client spec 019): a node between channelMerger and destinationGain
  // (the vinyl scratch node). Kept across reset() / initializeAudio().
  preGainInsert = null;

  constructor(audioContext) {
    this.audioContext = audioContext;
    this.initializeAudio();
  }

  initializeAudio() {
    const audioContext = this.audioContext;
    const maxChannelCount = audioContext.destination.maxChannelCount;
    this.audioContext.destination.channelCount = maxChannelCount;
    this.channelMerger = new ChannelMergerNode(audioContext, { numberOfInputs: audioContext.destination.channelCount });
    this.destinationGain = new GainNode(audioContext);
    this.connectPreGain(this.preGainInsert); // fork: channelMerger → [insert] → destinationGain (spec 019)
    this.outputSwitches = new Map();
    this.destinationGain.connect(this.outputInsert ?? audioContext.destination); // fork: insert (spec 008)
    // fork (spec 020): the insert sizes itself to the output's channels, which a reset can change.
    if (this.outputInsert && this.outputInsertOptions?.onChannelCount) {
      try {
        this.outputInsertOptions.onChannelCount(audioContext.destination.channelCount);
      } catch (err) {
        console.warn('[superdough] output insert onChannelCount failed:', err);
      }
    }
  }

  /** @private Fork addition (spec 020): destinationGain → new switch gain (at `gain`) → target. */
  connectOutputPath(target, gain) {
    const sw = new GainNode(this.audioContext, { gain });
    this.destinationGain.connect(sw);
    sw.connect(target);
    this.outputSwitches.set(target, sw);
    return sw;
  }

  /** @private Fork addition (spec 020): remove a switch gain (both its edges). */
  dropOutputPath(target) {
    const sw = this.outputSwitches.get(target);
    if (!sw) return;
    try {
      this.destinationGain?.disconnect(sw);
    } catch {
      // already disconnected
    }
    sw.disconnect();
    this.outputSwitches.delete(target);
  }

  /** @private Fork addition (spec 020): the gain that carries destinationGain into `target`, made if it is the bare edge. */
  outputPathGain(target) {
    let sw = this.outputSwitches.get(target);
    if (!sw) {
      // The bare edge: swap it for a switch gain at 1, in one task (no audible change).
      sw = this.connectOutputPath(target, 1);
      try {
        this.destinationGain.disconnect(target);
      } catch {
        // was not connected
      }
    }
    return sw;
  }

  /** @private Fork addition (spec 019): wire channelMerger → node → destinationGain, or the direct edge. */
  connectPreGain(node) {
    if (node) {
      this.channelMerger.connect(node);
      node.connect(this.destinationGain);
    } else {
      this.channelMerger.connect(this.destinationGain);
    }
  }

  /** @private Fork addition (spec 019): remove only the edges connectPreGain(node) made. */
  disconnectPreGain(node) {
    const edges = node
      ? [
          [this.channelMerger, node],
          [node, this.destinationGain],
        ]
      : [[this.channelMerger, this.destinationGain]];
    for (const [from, to] of edges) {
      try {
        from.disconnect(to);
      } catch {
        // was not connected
      }
    }
  }

  /**
   * Fork addition (strudel-client spec 019). Put `node` between `channelMerger` and
   * `destinationGain` (`channelMerger → node → destinationGain`); `null` restores the direct
   * edge. The insert is kept across `reset()`, which rebuilds the merger and the gain, and only
   * the insert's own two edges are ever touched: its other connections stay as they are. Without
   * an insert the graph is the upstream one. Everything on `destinationGain` (gain ramps,
   * recorders, `setOutputInsert`) is after this insert, so it hears and shapes what `node` outputs.
   * @param {AudioNode|null} node
   * @noAutocomplete
   */
  setPreGainInsert(node) {
    const next = node ?? null;
    if (next === this.preGainInsert) {
      return;
    }
    const previous = this.preGainInsert;
    this.preGainInsert = next;
    if (this.channelMerger && this.destinationGain) {
      // New path first, then drop the old one.
      this.connectPreGain(next);
      this.disconnectPreGain(previous);
    }
  }

  /**
   * Fork addition (strudel-client spec 019). The node set by `setPreGainInsert`, or null.
   * @returns {AudioNode|null}
   * @noAutocomplete
   */
  getPreGainInsert() {
    return this.preGainInsert;
  }

  /**
   * Fork addition (strudel-client spec 008). Route `destinationGain` into `node` instead of
   * `audioContext.destination`; `null` (or the destination itself) restores the destination.
   * The insert is kept across `reset()`, which rebuilds `destinationGain`. It is the caller's job to connect `node` onward
   * (to the destination) and to keep its channel count mode non-`explicit`, so a multichannel
   * merger is not downmixed. Taps on `destinationGain` (recorders, transitions) stay pre-insert.
   *
   * Spec 020: while the context runs, the swap is click-free and leaves `destinationGain` alone: the
   * audible path fades out over OUTPUT_INSERT_FADE_TIME, then the new one fades in over the same time
   * (temporary switch gains after `destinationGain`; once settled the bare edge is back, so the graph
   * at rest is the spec 008 one). Keep the previous insert connected onward until the returned time.
   * @param {AudioNode|null} node
   * @param {{ onChannelCount?: (channelCount: number) => void }} [options] - `onChannelCount` is
   *   called with the output's channel count whenever `reset()` rebuilds the output while `node` is set
   * @returns {number} seconds until the previous target is silent (0: at once)
   * @noAutocomplete
   */
  setOutputInsert(node, options = null) {
    // The destination itself is "no insert" (connecting it twice and then disconnecting the
    // previous target would leave destinationGain connected to nothing).
    const next = node == null || node === this.audioContext.destination ? null : node;
    this.outputInsertOptions = next ? options : null;
    if (next === this.outputInsert) {
      return 0;
    }
    const destination = this.audioContext.destination;
    const previous = this.outputInsert ?? destination;
    const target = next ?? destination;
    this.outputInsert = next;
    if (!this.destinationGain) {
      return 0;
    }
    if (this.audioContext.state !== 'running') {
      // Nothing is playing: switch the bare edge at once.
      [...this.outputSwitches.keys()].forEach((t) => this.dropOutputPath(t));
      this.destinationGain.connect(target);
      try {
        this.destinationGain.disconnect(previous);
      } catch {
        // was not connected to it
      }
      return 0;
    }
    const fade = OUTPUT_INSERT_FADE_TIME;
    const now = this.audioContext.currentTime;
    const ramp = (param, from, to, start, end) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      if (start > now) param.setValueAtTime(from, start);
      param.linearRampToValueAtTime(to, end);
    };
    const out = this.outputPathGain(previous);
    ramp(out.gain, out.gain.value, 0, now, now + fade);
    const into = this.outputSwitches.get(target) ?? this.connectOutputPath(target, 0);
    ramp(into.gain, into.gain.value, 1, now + fade, now + 2 * fade); // value: 0, or mid-fade if reversed
    // Clean up once silent (inaudible either way): drop the old path, and put the bare edge back
    // for the current target (a gain of exactly 1 swapped for the edge in one task).
    const gainNode = this.destinationGain;
    setTimeout(
      () => {
        if (this.destinationGain !== gainNode) return; // reset() rebuilt the paths
        const current = this.outputInsert ?? destination;
        if (this.outputSwitches.get(previous) === out && previous !== current) {
          this.dropOutputPath(previous);
        }
        const sw = this.outputSwitches.get(current);
        if (sw && sw.gain.value === 1 && this.outputSwitches.size === 1) {
          this.destinationGain.connect(current);
          this.dropOutputPath(current);
        }
      },
      (2 * fade + 0.03) * 1000,
    );
    return fade;
  }

  reset() {
    this.disconnect();
    this.initializeAudio();
  }
  disconnect() {
    // fork (spec 019): the pre-gain insert outlives this merger/gain; drop only its edge into the old gain.
    if (this.preGainInsert) {
      this.disconnectPreGain(this.preGainInsert);
    }
    this.channelMerger.disconnect();
    this.destinationGain.disconnect();
    this.outputSwitches.forEach((sw) => sw.disconnect()); // fork (spec 020)
    this.outputSwitches.clear();
    this.destinationGain = null;
    this.channelMerger = null;
  }
  connectToDestination = (input, channels = [0, 1]) => {
    //This upmix can be removed if correct channel counts are set throughout the app,
    // and then strudel could theoretically support surround sound audio files
    const stereoMix = new StereoPannerNode(this.audioContext);
    input.connect(stereoMix);

    const splitter = new ChannelSplitterNode(this.audioContext, {
      numberOfOutputs: stereoMix.channelCount,
    });
    stereoMix.connect(splitter);
    channels.forEach((ch, i) => {
      splitter.connect(this.channelMerger, i % stereoMix.channelCount, ch % this.audioContext.destination.channelCount);
    });
  };
}

export class SuperdoughAudioController {
  audioContext;
  output;
  nodes = {};

  constructor(audioContext) {
    this.audioContext = audioContext;
    this.output = new SuperdoughOutput(audioContext);
  }

  /**
   * Fork addition (strudel-client spec 008). See `SuperdoughOutput.setOutputInsert`: the main
   * output plays into `node` (e.g. the main EQ's input) instead of the destination; `null` restores it.
   * Click-free while playing (spec 020).
   * @param {AudioNode|null} node
   * @param {{ onChannelCount?: (channelCount: number) => void }} [options]
   * @returns {number} seconds until the previous target is silent
   * @noAutocomplete
   */
  setOutputInsert(node, options) {
    return this.output.setOutputInsert(node, options);
  }

  /**
   * Fork addition (strudel-client spec 019). See `SuperdoughOutput.setPreGainInsert`: `node` sits
   * between the orbits' merger and the destination gain (the vinyl scratch node); `null` removes it.
   * @param {AudioNode|null} node
   * @noAutocomplete
   */
  setPreGainInsert(node) {
    this.output.setPreGainInsert(node);
  }

  /**
   * Fork addition (strudel-client spec 019). The current pre-gain insert, or null.
   * @returns {AudioNode|null}
   * @noAutocomplete
   */
  getPreGainInsert() {
    return this.output.getPreGainInsert();
  }

  reset() {
    Array.from(this.nodes).forEach((node) => {
      node.disconnect();
    });
    this.nodes = {};
    this.output.reset();
  }

  duck(targetOrbits, t, onsettime = 0, attacktime = 0.1, depth = 1) {
    const targetArr = [targetOrbits].flat();
    const onsetArr = [onsettime].flat();
    const attackArr = [attacktime].flat();
    const depthArr = [depth].flat();

    targetArr.forEach((target, idx) => {
      const orbit = this.nodes[target];

      if (orbit == null) {
        errorLogger(new Error(`duck target orbit ${target} does not exist`), 'superdough');
        return;
      }
      const onset = onsetArr[idx] ?? onsetArr[0];
      const attack = Math.max(attackArr[idx] ?? attackArr[0], 0.002);
      const depth = depthArr[idx] ?? depthArr[0];

      orbit.duck(t, onset, attack, depth);
    });
  }

  getOrbit(orbitNum, channels) {
    if (this.nodes[orbitNum] == null) {
      this.nodes[orbitNum] = new Orbit(this.audioContext);
      this.output.connectToDestination(this.nodes[orbitNum].output, channels);
    }
    return this.nodes[orbitNum];
  }
}
