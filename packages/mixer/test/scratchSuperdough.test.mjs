/**
 * Spec 019 task 2.1 + 2.2/2.3 end to end on the mock graph: ScratchDeck and the PreviewEngine's
 * headphone deck attach to the REAL SuperdoughAudioController through setPreGainInsert, survive a
 * reset() (what resetGlobalEffects runs), coexist with the spec 008 output insert, and leave the
 * upstream graph behind on destroy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SuperdoughAudioController } from 'superdough';
import { ScratchDeck } from '../scratch/ScratchDeck.mjs';
import { PreviewEngine } from '../PreviewEngine.mjs';
import { MockAudioContext, stubWebAudio, stubWebAudioNodeConstructors, unstubWebAudio } from './webAudioMock.mjs';

describe('ScratchDeck on the real superdough output', () => {
  let ac;
  let controller;
  let warn;
  const merger = () => controller.output.channelMerger;
  const gain = () => controller.output.destinationGain;

  beforeEach(() => {
    stubWebAudio();
    stubWebAudioNodeConstructors();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ac = new MockAudioContext();
    controller = new SuperdoughAudioController(ac);
  });
  afterEach(() => {
    warn.mockRestore();
    unstubWebAudio();
  });

  it('main deck: attaches between the merger and destinationGain, survives reset, destroy restores upstream', async () => {
    const deck = new ScratchDeck(ac, controller);
    await expect(deck.attach()).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
    const node = ac.workletNodes[0];
    expect(controller.getPreGainInsert()).toBe(node);
    expect(merger().connections).toEqual([node]);
    expect(node.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([ac.destination]);

    // 5 grab/release cycles + a reset (resetGlobalEffects): still one node, wired to the new gain.
    for (let i = 0; i < 5; i++) {
      deck.grab();
      deck.moveBy(-0.1);
      deck.release();
    }
    controller.reset();
    expect(ac.workletNodes).toHaveLength(1);
    expect(merger().connections).toEqual([node]);
    expect(node.connections).toEqual([gain()]);

    deck.destroy();
    expect(controller.getPreGainInsert()).toBeNull();
    expect(merger().connections).toEqual([gain()]);
    expect(node.connections).toEqual([]);
    expect(node.port.closed).toBe(true);
  });

  it('coexists with the spec 008 output insert (main EQ)', async () => {
    const eq = ac.createGain();
    ac.state = 'suspended'; // spec 020: an immediate switch (a swap while playing fades on a timer)
    controller.setOutputInsert(eq);
    ac.state = 'running';
    const deck = new ScratchDeck(ac, controller);
    await deck.attach();
    const node = ac.workletNodes[0];
    expect(merger().connections).toEqual([node]);
    expect(node.connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eq]);
    deck.destroy();
    expect(merger().connections).toEqual([gain()]);
    expect(gain().connections).toEqual([eq]);
  });

  it('PreviewEngine.ensureScratchDeck attaches on the preview engine’s own real controller', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new PreviewEngine(ac, {
      SuperdoughAudioController,
      superdough: vi.fn(),
      repl: () => ({ evaluate: vi.fn(), stop: vi.fn() }),
      getTime: () => ac.currentTime,
    });
    await engine.initialize();
    expect(ac.workletNodes).toHaveLength(0);
    const deck = await engine.ensureScratchDeck();
    expect(deck).toBeInstanceOf(ScratchDeck);
    const node = ac.workletNodes[0];
    const preview = engine.controller;
    expect(preview).not.toBe(controller);
    expect(preview.getPreGainInsert()).toBe(node);
    expect(preview.output.channelMerger.connections).toEqual([node]);
    expect(node.connections).toEqual([preview.output.destinationGain]);
    // The main controller is untouched (decks are independent).
    expect(controller.getPreGainInsert()).toBeNull();
    engine.destroy();
    expect(node.port.closed).toBe(true);
    log.mockRestore();
  });
});
