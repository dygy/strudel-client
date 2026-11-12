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

export class SuperdoughOutput {
  channelMerger;
  destinationGain;
  // fork addition (strudel-client spec 008): where destinationGain plays into instead of
  // audioContext.destination (e.g. the main EQ). Kept across reset() / initializeAudio().
  outputInsert = null;
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
    this.destinationGain.connect(this.outputInsert ?? audioContext.destination); // fork: insert (spec 008)
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
   * @param {AudioNode|null} node
   * @noAutocomplete
   */
  setOutputInsert(node) {
    // The destination itself is "no insert" (connecting it twice and then disconnecting the
    // previous target would leave destinationGain connected to nothing).
    const next = node == null || node === this.audioContext.destination ? null : node;
    if (next === this.outputInsert) {
      return;
    }
    const previous = this.outputInsert ?? this.audioContext.destination;
    this.outputInsert = next;
    if (this.destinationGain) {
      this.destinationGain.connect(next ?? this.audioContext.destination);
      try {
        this.destinationGain.disconnect(previous);
      } catch {
        // was not connected to it
      }
    }
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
   * @param {AudioNode|null} node
   * @noAutocomplete
   */
  setOutputInsert(node) {
    this.output.setOutputInsert(node);
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
