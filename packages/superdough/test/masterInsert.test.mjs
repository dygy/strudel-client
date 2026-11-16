/**
 * @spec: 032-master-fx (tech §2.1)
 * superdough fork addition for strudel-client spec 032 (setMasterInsert): a sub-graph (input,
 * output) between the pre-gain insert (the scratch node; or the merger without one) and
 * destinationGain, which the direct inputs (`.dough()`) play into too. It is kept across reset(),
 * which resetGlobalEffects() runs and which rebuilds the merger and the gain, calls onChannelCount
 * there, touches only its own edges, and `null` restores the spec 019 graph exactly. Also: sources
 * given to connectToDestination with `{ keep: true }` (the `.supradough()` worklet) are re-routed
 * into the rebuilt merger.
 *
 * Self-contained Web Audio mock, as in preGainInsert.test.mjs: nodes record their connections, and
 * disconnect(target) throws when not connected, as in Web Audio.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController } from '../superdoughoutput.mjs';

function makeNode(kind, extra = {}) {
  return {
    kind,
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect(target) {
      if (target === undefined) {
        this.connections = [];
        return;
      }
      if (!this.connections.includes(target)) {
        throw new Error('InvalidAccessError: not connected');
      }
      this.connections = this.connections.filter((c) => c !== target);
    },
    ...extra,
  };
}

function makeContext() {
  return { destination: makeNode('destination', { channelCount: 2, maxChannelCount: 2 }) };
}

function stubNodeConstructors() {
  const ctor = (kind) =>
    function (_ac, options = {}) {
      return makeNode(kind, { options, channelCount: 2 });
    };
  vi.stubGlobal('GainNode', ctor('GainNode'));
  vi.stubGlobal('ChannelMergerNode', ctor('ChannelMergerNode'));
  vi.stubGlobal('StereoPannerNode', ctor('StereoPannerNode'));
  vi.stubGlobal('ChannelSplitterNode', ctor('ChannelSplitterNode'));
}

describe('SuperdoughAudioController.setMasterInsert (spec 032, fork addition)', () => {
  let ac;
  let controller;
  let fxIn;
  let fxOut;
  let scratch;
  const merger = () => controller.output.channelMerger;
  const gain = () => controller.output.destinationGain;

  beforeEach(() => {
    stubNodeConstructors();
    ac = makeContext();
    controller = new SuperdoughAudioController(ac);
    fxIn = makeNode('fxIn');
    fxOut = makeNode('fxOut');
    scratch = makeNode('scratch');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without a master insert the graph is the spec 019 one (negative: nothing routed elsewhere)', () => {
    expect(controller.getMasterInsert()).toBeNull();
    expect(merger().connections).toEqual([gain()]);
    controller.setPreGainInsert(scratch);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
  });

  it('no scratch insert: merger → fx input; fx output → destinationGain; no direct edge left', () => {
    controller.setMasterInsert(fxIn, { output: fxOut });
    expect(controller.getMasterInsert()).toBe(fxIn);
    expect(merger().connections).toEqual([fxIn]);
    expect(fxOut.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([ac.destination]);
  });

  it('with a scratch insert: merger → scratch → fx → destinationGain (set before or after the scratch)', () => {
    controller.setPreGainInsert(scratch);
    controller.setMasterInsert(fxIn, { output: fxOut });
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([fxIn]);
    expect(fxOut.connections).toEqual([gain()]);

    controller.setPreGainInsert(null);
    expect(merger().connections).toEqual([fxIn]);
    expect(scratch.connections).toEqual([]);
    controller.setPreGainInsert(scratch); // scratch added while the master insert is set
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([fxIn]);
  });

  it('output defaults to the node itself', () => {
    controller.setMasterInsert(fxIn);
    expect(merger().connections).toEqual([fxIn]);
    expect(fxIn.connections).toEqual([gain()]);
  });

  it('direct inputs play into the fx input, whether connected before or after it', () => {
    const before = makeNode('dough1');
    controller.connectDirectInput(before);
    controller.setMasterInsert(fxIn, { output: fxOut });
    const after = makeNode('dough2');
    controller.connectDirectInput(after);
    expect(before.connections).toEqual([fxIn]);
    expect(after.connections).toEqual([fxIn]);
    controller.disconnectDirectInput(after);
    expect(after.connections).toEqual([]);
  });

  it('kept across reset(): re-wired to the rebuilt nodes, onChannelCount called, nothing left on the old ones', () => {
    const onChannelCount = vi.fn();
    const dough = makeNode('dough');
    controller.connectDirectInput(dough);
    controller.setPreGainInsert(scratch);
    controller.setMasterInsert(fxIn, { output: fxOut, onChannelCount });
    expect(onChannelCount).not.toHaveBeenCalled();
    const oldMerger = merger();
    const oldGain = gain();
    ac.destination.maxChannelCount = 6;
    controller.reset();
    expect(gain()).not.toBe(oldGain);
    expect(onChannelCount).toHaveBeenCalledExactlyOnceWith(6);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([fxIn]);
    expect(dough.connections).toEqual([fxIn]);
    expect(fxOut.connections).toEqual([gain()]); // not into the old gain any more
    expect(oldMerger.connections).toEqual([]);
    expect(oldGain.connections).toEqual([]);
    controller.reset();
    controller.reset();
    expect(scratch.connections).toEqual([fxIn]);
    expect(fxOut.connections).toEqual([gain()]);
    expect(dough.connections).toEqual([fxIn]);
    expect(onChannelCount).toHaveBeenCalledTimes(3);
  });

  it('a throwing onChannelCount does not break the reset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    controller.setMasterInsert(fxIn, {
      output: fxOut,
      onChannelCount: () => {
        throw new Error('boom');
      },
    });
    expect(() => controller.reset()).not.toThrow();
    expect(fxOut.connections).toEqual([gain()]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('null restores the old edges exactly (scratch, direct inputs), also after a reset', () => {
    const dough = makeNode('dough');
    controller.connectDirectInput(dough);
    controller.setPreGainInsert(scratch);
    controller.setMasterInsert(fxIn, { output: fxOut });
    controller.reset();
    controller.setMasterInsert(null);
    expect(controller.getMasterInsert()).toBeNull();
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
    expect(dough.connections).toEqual([gain()]);
    expect(fxOut.connections).toEqual([]);
    controller.reset();
    expect(scratch.connections).toEqual([gain()]);
    expect(dough.connections).toEqual([gain()]);
    expect(fxOut.connections).toEqual([]);
  });

  it("touches only the slot's own edges: the sub-graph's inner wiring survives set, reset and null", () => {
    fxIn.connect(fxOut); // the stage's own wiring
    controller.setMasterInsert(fxIn, { output: fxOut });
    controller.reset();
    controller.setMasterInsert(null);
    expect(fxIn.connections).toEqual([fxOut]);
  });

  it('swapping one master insert for another leaves the old one unconnected', () => {
    const otherIn = makeNode('otherIn');
    const otherOut = makeNode('otherOut');
    controller.setPreGainInsert(scratch);
    controller.setMasterInsert(fxIn, { output: fxOut });
    controller.setMasterInsert(otherIn, { output: otherOut });
    expect(scratch.connections).toEqual([otherIn]);
    expect(otherOut.connections).toEqual([gain()]);
    expect(fxOut.connections).toEqual([]);
  });

  it('setting the same insert twice connects it once; options are updated', () => {
    const onChannelCount = vi.fn();
    controller.setMasterInsert(fxIn, { output: fxOut });
    controller.setMasterInsert(fxIn, { output: fxOut, onChannelCount });
    expect(merger().connections).toEqual([fxIn]);
    expect(fxOut.connections).toEqual([gain()]);
    controller.reset();
    expect(onChannelCount).toHaveBeenCalledTimes(1);
  });

  it('orbits feed the fx (through the merger), and the output insert stays after destinationGain', () => {
    const eq = makeNode('eq');
    controller.setOutputInsert(eq);
    controller.setMasterInsert(fxIn, { output: fxOut });
    controller.getOrbit(1);
    expect(merger().connections).toEqual([fxIn]);
    expect(gain().connections).toEqual([eq]);
  });
});

describe('SuperdoughOutput.connectToDestination { keep } (spec 032: supradough across a reset)', () => {
  let ac;
  let controller;

  beforeEach(() => {
    stubNodeConstructors();
    ac = makeContext();
    controller = new SuperdoughAudioController(ac);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** The splitter that carries `source` (source → stereoMix → splitter). */
  const splitterOf = (source) => source.connections[0].connections[0];

  it('a kept source is re-routed into the rebuilt merger; the old merger has nothing left from it', () => {
    const source = makeNode('dough-worklet');
    controller.output.connectToDestination(source, undefined, { keep: true });
    const splitter = splitterOf(source);
    const oldMerger = controller.output.channelMerger;
    expect(splitter.connections).toEqual([oldMerger, oldMerger]);
    controller.reset();
    expect(splitter.connections).toEqual([controller.output.channelMerger, controller.output.channelMerger]);
    // Keeping the same source twice routes it once.
    controller.output.connectToDestination(source, undefined, { keep: true });
    expect(source.connections).toHaveLength(1);
  });

  it('negative: a source connected without keep stays on the old merger (upstream behaviour)', () => {
    const source = makeNode('one-shot');
    controller.output.connectToDestination(source);
    const oldMerger = controller.output.channelMerger;
    controller.reset();
    expect(splitterOf(source).connections).toEqual([oldMerger, oldMerger]);
  });
});
