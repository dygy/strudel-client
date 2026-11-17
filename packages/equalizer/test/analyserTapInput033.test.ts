/**
 * @spec: 033-loudness-meter (functional §2.1, §2.7, tech §2.2, §4)
 * AudioEqualizer additions for the loudness meter, all additive:
 * - createAnalyserTap({ point: 'input' }) taps the signal entering the EQ; the default is unchanged
 *   (the final output); dispose and destroy() disconnect both kinds;
 * - getLimiterInput() is the output level node while on, null while off or destroyed, and the same
 *   node across setChannelCount;
 * - onTopologyChange fires on a real on/off change, on a limiter-stage rebuild and on destroy().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEqualizer, type EqualizerTopologyChange } from '../AudioEqualizer';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../mixer/test/webAudioMock.mjs';

let ac: any;
let eq: AudioEqualizer;

beforeEach(() => {
  ac = new MockAudioContext();
  eq = new AudioEqualizer(ac as unknown as AudioContext);
});

/** Every connection in the EQ's graph, as [from, to] pairs. */
const graph = () =>
  ac.createdNodes.flatMap((node: any) => node.connections.map((target: any) => [node, target] as const));

describe("createAnalyserTap({ point: 'input' }) (spec 033)", () => {
  it('connects the analyser from the EQ input, not the output', () => {
    const input = eq.getInput() as any;
    const output = eq.getOutput() as any;
    const tap = eq.createAnalyserTap({ point: 'input' });
    expect(tap.point).toBe('input');
    expect(input.connections).toContain(tap.analyser);
    expect(output.connections).not.toContain(tap.analyser);
    expect((tap.analyser as any).connections).toEqual([]);
  });

  it('the default is unchanged: no options, or options without point, tap the final output', () => {
    const input = eq.getInput() as any;
    const output = eq.getOutput() as any;
    const plain = eq.createAnalyserTap();
    const sized = eq.createAnalyserTap({ fftSize: 2048 });
    for (const tap of [plain, sized]) {
      expect(tap.point).toBe('output');
      expect(output.connections).toContain(tap.analyser);
      expect(input.connections).not.toContain(tap.analyser);
    }
    expect(sized.analyser.fftSize).toBe(2048);
  });

  it('is a fan-out: dispose restores the exact graph, and a second dispose does nothing', () => {
    eq.getOutput().connect(ac.destination);
    const before = graph();
    const tap = eq.createAnalyserTap({ point: 'input' });
    expect(graph().filter(([, to]: any) => to === tap.analyser)).toEqual([[eq.getInput(), tap.analyser]]);
    tap.dispose();
    expect(graph()).toEqual(before);
    tap.dispose();
    expect(graph()).toEqual(before);
    expect(eq.getAnalyserTapCount()).toBe(0);
  });

  it('input and output taps coexist; destroy() disconnects both kinds', () => {
    const pre = eq.createAnalyserTap({ point: 'input' });
    const post = eq.createAnalyserTap();
    expect(eq.getAnalyserTapCount()).toBe(2);
    eq.destroy();
    expect(eq.getAnalyserTapCount()).toBe(0);
    expect((eq.getInput() as any).connections).not.toContain(pre.analyser);
    expect((eq.getOutput() as any).connections).not.toContain(post.analyser);
  });

  it('negative: an unknown point throws instead of tapping somewhere unexpected', () => {
    expect(() => eq.createAnalyserTap({ point: 'middle' as any })).toThrow(RangeError);
    expect(eq.getAnalyserTapCount()).toBe(0);
  });
});

describe('getLimiterInput() (spec 033)', () => {
  /** The node that feeds the limiter stage: the wet chain's last gain (the output level). */
  const limiterFeed = () =>
    ac.createdNodes.find(
      (n: any) => n.kind === 'Gain' && n.connections.some((t: any) => t.kind === 'DynamicsCompressor'),
    );

  it('is the node feeding the limiter while the EQ is on', () => {
    const node = eq.getLimiterInput() as any;
    expect(node).not.toBeNull();
    expect(node).toBe(limiterFeed());
  });

  it('is null while the EQ is off (the off path bypasses the limiter), and back when on', () => {
    const on = eq.getLimiterInput();
    eq.setEnabled(false);
    expect(eq.getLimiterInput()).toBeNull();
    eq.setEnabled(true);
    expect(eq.getLimiterInput()).toBe(on);
  });

  it('is null after destroy()', () => {
    eq.destroy();
    expect(eq.getLimiterInput()).toBeNull();
  });

  it('is the same node after setChannelCount rebuilds the limiter stage', () => {
    const before = eq.getLimiterInput();
    eq.setChannelCount(6);
    expect(eq.getLimiterInput()).toBe(before);
    expect((before as any).connections.some((t: any) => t.kind === 'ChannelSplitter')).toBe(true);
  });
});

describe('onTopologyChange (spec 033)', () => {
  it('fires on a real on/off change with the new limiter input', () => {
    const changes: EqualizerTopologyChange[] = [];
    eq.onTopologyChange((c) => changes.push(c));
    const node = eq.getLimiterInput();
    eq.setEnabled(false);
    eq.setEnabled(true);
    expect(changes).toEqual([
      { reason: 'enabled', limiterInput: null },
      { reason: 'enabled', limiterInput: node },
    ]);
  });

  it('negative: setEnabled with the same value (e.g. setState) does not fire', () => {
    const listener = vi.fn();
    eq.onTopologyChange(listener);
    eq.setEnabled(true);
    eq.setState({ isEnabled: true, bands: [] });
    expect(listener).not.toHaveBeenCalled();
  });

  it('fires when setChannelCount rebuilds the limiter stage; negative: not for the same count', () => {
    const listener = vi.fn();
    eq.onTopologyChange(listener);
    eq.setChannelCount(2);
    expect(listener).not.toHaveBeenCalled();
    eq.setChannelCount(4);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ reason: 'channels', limiterInput: eq.getLimiterInput() });
  });

  it('fires once on destroy() with a null limiter input, then forgets its listeners', () => {
    const listener = vi.fn();
    eq.onTopologyChange(listener);
    eq.destroy();
    eq.destroy();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ reason: 'destroyed', limiterInput: null });
    expect(eq.onTopologyChange(listener)).toBeTypeOf('function');
    eq.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery; a throwing listener does not stop the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kept = vi.fn();
    const off = eq.onTopologyChange(vi.fn());
    eq.onTopologyChange(() => {
      throw new Error('boom');
    });
    eq.onTopologyChange(kept);
    off();
    eq.setEnabled(false);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
