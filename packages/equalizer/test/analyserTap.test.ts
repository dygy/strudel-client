/**
 * @spec: 026-eq-listening-tools (functional §2.2, tech §2.2, §3)
 * The spectrum tap: an AnalyserNode (4096-point FFT, smoothing 0.8) fed as a fan-out from the EQ's
 * final output. The output's own connections are unchanged (so are its samples: a fan-out adds a
 * reader, not a stage); dispose() disconnects exactly the analyser, once; destroy() disconnects it too.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEqualizer, ANALYSER_TAP } from '../AudioEqualizer';
import * as api from '../index';
// @ts-expect-error untyped .mjs test helper shared with @strudel/mixer
import { MockAudioContext } from '../../mixer/test/webAudioMock.mjs';

let ac: any;
let eq: AudioEqualizer;

beforeEach(() => {
  ac = new MockAudioContext();
  eq = new AudioEqualizer(ac as unknown as AudioContext);
});

/** Every connection in the EQ's graph, as [from, to] pairs (the EQ's own nodes). */
const graph = () =>
  ac.createdNodes.flatMap((node: any) => node.connections.map((target: any) => [node, target] as const));

describe('AudioEqualizer.createAnalyserTap (spec 026)', () => {
  it('is exported, with its defaults', () => {
    expect(api.ANALYSER_TAP).toEqual({ fftSize: 4096, smoothingTimeConstant: 0.8 });
  });

  it('connects an analyser to the final output, sized 4096 with smoothing 0.8', () => {
    const output = eq.getOutput() as any;
    const { analyser } = eq.createAnalyserTap();

    expect(output.connections).toContain(analyser);
    expect(analyser.fftSize).toBe(ANALYSER_TAP.fftSize);
    expect(analyser.smoothingTimeConstant).toBe(ANALYSER_TAP.smoothingTimeConstant);
    expect((analyser as any).connections).toEqual([]); // a reader: it feeds nothing
    expect(eq.getAnalyserTapCount()).toBe(1);
  });

  it('is a fan-out: every other connection in the graph is unchanged, and the output still reaches its target', () => {
    const destination = ac.destination;
    eq.getOutput().connect(destination);
    const before = graph();

    const { analyser, dispose } = eq.createAnalyserTap();
    const during = graph();
    expect(during.filter(([, to]: any) => to !== analyser)).toEqual(before);
    expect(during.filter(([, to]: any) => to === analyser)).toEqual([[eq.getOutput(), analyser]]);
    expect((eq.getOutput() as any).connections).toContain(destination);

    dispose();
    expect(graph()).toEqual(before);
  });

  it('dispose disconnects only the analyser, and a second dispose does nothing', () => {
    const destination = ac.destination;
    const output = eq.getOutput() as any;
    output.connect(destination);
    const { analyser, dispose } = eq.createAnalyserTap();

    dispose();
    expect(output.connections).not.toContain(analyser);
    expect(output.connections).toContain(destination);
    expect(eq.getAnalyserTapCount()).toBe(0);
    const disconnects = output.disconnected;
    dispose();
    expect(output.disconnected).toBe(disconnects);
  });

  it('repeated taps do not leak: N create/dispose cycles leave no analyser connected', () => {
    for (let i = 0; i < 50; i++) eq.createAnalyserTap().dispose();
    expect((eq.getOutput() as any).connections.filter((n: any) => n.kind === 'Analyser')).toEqual([]);
    expect(eq.getAnalyserTapCount()).toBe(0);
  });

  it('destroy() disconnects a tap that is still open; its dispose afterwards is harmless', () => {
    const output = eq.getOutput() as any;
    const { analyser, dispose } = eq.createAnalyserTap();

    eq.destroy();
    expect(output.connections).not.toContain(analyser);
    expect(eq.getAnalyserTapCount()).toBe(0);
    expect(() => dispose()).not.toThrow();
  });

  it('reports the sample rate and whether the context runs', () => {
    const tap = eq.createAnalyserTap();
    expect(tap.sampleRate).toBe(ac.sampleRate);
    ac.state = 'running';
    expect(tap.isRunning()).toBe(true);
    ac.state = 'suspended';
    expect(tap.isRunning()).toBe(false);
  });

  it('takes its own FFT size and smoothing when given', () => {
    const { analyser } = eq.createAnalyserTap({ fftSize: 2048, smoothingTimeConstant: 0.5 });
    expect([analyser.fftSize, analyser.smoothingTimeConstant]).toEqual([2048, 0.5]);
  });
});
