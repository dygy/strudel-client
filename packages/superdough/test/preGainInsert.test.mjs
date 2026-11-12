/**
 * superdough fork addition for strudel-client spec 019 (setPreGainInsert): a node between the
 * orbits' channelMerger and destinationGain (the vinyl scratch node). It survives reset(), which
 * resetGlobalEffects() runs and which rebuilds both, touches only its own edges, and coexists
 * with the spec 008 setOutputInsert. Without an insert the graph is the upstream one.
 *
 * Self-contained Web Audio mock (no dependency on other packages' test helpers): nodes record
 * their connections, and disconnect(target) throws when not connected, as in Web Audio.
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

describe('SuperdoughAudioController.setPreGainInsert (spec 019, fork addition)', () => {
  let ac;
  let controller;
  let scratch;
  const merger = () => controller.output.channelMerger;
  const gain = () => controller.output.destinationGain;

  beforeEach(() => {
    stubNodeConstructors();
    ac = makeContext();
    controller = new SuperdoughAudioController(ac);
    scratch = makeNode('scratch');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without an insert the graph is upstream: merger → destinationGain → destination', () => {
    expect(controller.getPreGainInsert()).toBeNull();
    expect(merger().connections).toEqual([gain()]);
    expect(gain().connections).toEqual([ac.destination]);
  });

  it('wires channelMerger → insert → destinationGain, with no direct edge left', () => {
    controller.setPreGainInsert(scratch);
    expect(controller.getPreGainInsert()).toBe(scratch);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([ac.destination]);
  });

  it('null restores the direct edge and leaves the insert connected to nothing of ours', () => {
    controller.setPreGainInsert(scratch);
    controller.setPreGainInsert(null);
    expect(controller.getPreGainInsert()).toBeNull();
    expect(merger().connections).toEqual([gain()]);
    expect(scratch.connections).toEqual([]);
  });

  it('survives reset(): the rebuilt merger and gain are wired through the insert; old edges are gone', () => {
    controller.setPreGainInsert(scratch);
    const oldMerger = merger();
    const oldGain = gain();
    controller.reset();
    expect(merger()).not.toBe(oldMerger);
    expect(gain()).not.toBe(oldGain);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]); // not into the old gain any more
    expect(oldMerger.connections).toEqual([]);
    expect(oldGain.connections).toEqual([]);
    // Repeated resets do not pile up edges on the insert.
    controller.reset();
    controller.reset();
    expect(scratch.connections).toEqual([gain()]);
  });

  it('null after a reset restores the direct edge on the rebuilt nodes', () => {
    controller.setPreGainInsert(scratch);
    controller.reset();
    controller.setPreGainInsert(null);
    expect(merger().connections).toEqual([gain()]);
    expect(scratch.connections).toEqual([]);
    controller.reset();
    expect(merger().connections).toEqual([gain()]);
  });

  it("touches only the insert's own edges: its other connections survive set, reset and null", () => {
    const meter = makeNode('meter');
    scratch.connect(meter); // e.g. a test tap the insert's owner made
    controller.setPreGainInsert(scratch);
    controller.reset();
    controller.setPreGainInsert(null);
    expect(scratch.connections).toEqual([meter]);
  });

  it('swapping one insert for another rewires without leaving the old one connected', () => {
    const other = makeNode('other');
    controller.setPreGainInsert(scratch);
    controller.setPreGainInsert(other);
    expect(merger().connections).toEqual([other]);
    expect(other.connections).toEqual([gain()]);
    expect(scratch.connections).toEqual([]);
  });

  it('setting the same insert twice connects it once', () => {
    controller.setPreGainInsert(scratch);
    controller.setPreGainInsert(scratch);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
  });

  it('coexists with the spec 008 output insert: merger → scratch → gain → EQ, also after reset', () => {
    const eq = makeNode('eq');
    controller.setOutputInsert(eq);
    controller.setPreGainInsert(scratch);
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eq]);
    controller.reset();
    expect(merger().connections).toEqual([scratch]);
    expect(scratch.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eq]);
    controller.setPreGainInsert(null);
    expect(merger().connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eq]);
    controller.setOutputInsert(null);
    expect(gain().connections).toEqual([ac.destination]);
  });

  it('orbits still feed the merger (the insert sees every orbit)', () => {
    controller.setPreGainInsert(scratch);
    controller.getOrbit(1);
    controller.getOrbit(2);
    expect(merger().connections).toEqual([scratch]);
  });
});
