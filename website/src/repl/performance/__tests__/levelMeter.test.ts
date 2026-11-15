// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (functional §2.4, tech §2.6)
 * The level meter's passive tap (an upmix gain, a splitter and two analysers fanned out from the main output, nothing
 * onward to any destination) and its ballistics (peak hold 1.5 s then −20 dB/s, clip latch 2 s, −60 dB floor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Node >= 25 ships its own global `localStorage`, which shadows jsdom's (see EqualizerCompact.test).
vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import { MockAudioContext } from '../../../../../packages/mixer/test/webAudioMock.mjs';

let ac: any;
let destinationGain: any;

/** Fresh modules with @strudel/webaudio pointing at the mock context (isolate:false: see memory note). */
async function load() {
  vi.resetModules();
  vi.doMock('@strudel/webaudio', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAudioContext: () => ac,
    getSuperdoughAudioController: () => ({ output: { destinationGain } }),
  }));
  const meter = await import('../levelMeter');
  const mainEq = await import('../../mainEqualizer');
  return { ...meter, ...mainEq };
}

/** Make an analyser's window a waveform: `sample(i)` for each index. */
function feed(analyser: any, sample: (i: number) => number) {
  analyser.getFloatTimeDomainData = (array: Float32Array) => {
    for (let i = 0; i < array.length; i++) array[i] = sample(i);
  };
}
const sine = (amplitude: number) => (i: number) => amplitude * Math.sin((2 * Math.PI * 1000 * i) / 48000);
const dbToLinear = (db: number) => 10 ** (db / 20);

const nodesOf = (kind: string) => ac.createdNodes.filter((n: any) => n.kind === kind);
/** The tap's upmix: the Gain the source feeds besides its own edges. */
const tapGain = (source: any) => source.connections.find((n: any) => n.kind === 'Gain');
/** The node feeding `splitter` (the tap's upmix). */
const splitterFeeder = (splitter: any) => ac.createdNodes.find((n: any) => n.connections.includes(splitter));
/** Every node reachable from `node` through connections. */
function reachable(node: any, seen = new Set<any>()): Set<any> {
  for (const next of node.connections ?? []) {
    if (!seen.has(next)) {
      seen.add(next);
      reachable(next, seen);
    }
  }
  return seen;
}

beforeEach(() => {
  ac = new MockAudioContext();
  // The shared mock does not record analysers in createdNodes (other suites count that list); do it here.
  const createAnalyser = ac.createAnalyser.bind(ac);
  ac.createAnalyser = () => ac._track(createAnalyser());
  destinationGain = ac.createGain();
});

afterEach(async () => {
  const { destroyMainEqualizer } = await import('../../mainEqualizer');
  destroyMainEqualizer();
  vi.doUnmock('@strudel/webaudio');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openLevelMeter: the tap', () => {
  it('builds a splitter fanned out from the source into two analysers, and nothing reaches destination', async () => {
    const { openLevelMeter } = await load();
    const source = ac.createGain();
    source.connect(ac.destination); // the speakers' edge
    openLevelMeter(ac, source);
    const [splitter] = nodesOf('ChannelSplitter');
    const upmix = tapGain(source);
    const analysers = nodesOf('Analyser');
    expect(analysers).toHaveLength(2);
    expect(source.connections).toEqual([ac.destination, upmix]);
    expect(upmix.connections).toEqual([splitter]);
    expect(splitter.routes.map((r: any) => [r.target, r.output])).toEqual([
      [analysers[0], 0],
      [analysers[1], 1],
    ]);
    expect(reachable(upmix).has(ac.destination)).toBe(false);
    analysers.forEach((a: any) => expect(a.connections).toEqual([]));
    // destinationGain + source + the upmix: a unity gain the tap never automates.
    expect(nodesOf('Gain')).toHaveLength(3);
    expect(upmix.gain.value).toBe(1);
    expect(upmix.gain.calls).toEqual([]);
  });

  it('upmixes in a GainNode (2 ch, explicit, speakers) and never assigns the splitter locked channel fields', async () => {
    const { openLevelMeter } = await load();
    const source = ac.createGain();
    expect(() => openLevelMeter(ac, source)).not.toThrow();
    const upmix = tapGain(source);
    expect([upmix.channelCount, upmix.channelCountMode, upmix.channelInterpretation]).toEqual([
      2,
      'explicit',
      'speakers',
    ]);
    const [splitter] = nodesOf('ChannelSplitter');
    expect([splitter.channelCount, splitter.channelCountMode, splitter.channelInterpretation]).toEqual([
      2,
      'explicit',
      'discrete',
    ]);
  });

  it('reads a −6 dBFS sine as −6 ± 1 dB peak on both channels', async () => {
    const { openLevelMeter } = await load();
    const tap = openLevelMeter(ac, ac.createGain());
    nodesOf('Analyser').forEach((a: any) => feed(a, sine(dbToLinear(-6))));
    const reading = tap.read();
    reading.peakDb.forEach((db) => expect(Math.abs(db - -6)).toBeLessThanOrEqual(1));
    reading.rmsDb.forEach((db) => expect(Math.abs(db - -9)).toBeLessThanOrEqual(1));
    expect(reading.over).toBe(false);
  });

  it('reads silence as -Infinity, per channel', async () => {
    const { openLevelMeter } = await load();
    const tap = openLevelMeter(ac, ac.createGain());
    const [, right] = nodesOf('Analyser');
    feed(right, sine(0.5));
    const reading = tap.read();
    expect(reading.peakDb[0]).toBe(-Infinity);
    expect(reading.rmsDb[0]).toBe(-Infinity);
    expect(reading.peakDb[1]).toBeCloseTo(20 * Math.log10(0.5), 1);
  });

  it('sets `over` at −0.3 dBFS (either channel) and not at −1 dBFS', async () => {
    const { openLevelMeter, OVER_LINEAR } = await load();
    const tap = openLevelMeter(ac, ac.createGain());
    const [left, right] = nodesOf('Analyser');
    expect(OVER_LINEAR).toBeCloseTo(0.966, 3);
    feed(left, () => dbToLinear(-1));
    feed(right, () => -dbToLinear(-1));
    expect(tap.read().over).toBe(false);
    feed(right, (i) => (i === 100 ? -dbToLinear(-0.3) : 0));
    expect(tap.read().over).toBe(true);
    feed(right, () => 0);
    feed(left, (i) => (i === 7 ? 1.2 : 0));
    expect(tap.read().over).toBe(true);
  });

  it('close() disconnects everything it made, leaves the speakers edge, and is idempotent', async () => {
    const { openLevelMeter } = await load();
    const source = ac.createGain();
    source.connect(ac.destination);
    const tap = openLevelMeter(ac, source);
    const [splitter] = nodesOf('ChannelSplitter');
    const upmix = tapGain(source);
    const analysers = nodesOf('Analyser');
    tap.close();
    expect(source.connections).toEqual([ac.destination]);
    expect(upmix.connections).toEqual([]);
    expect(splitter.connections).toEqual([]);
    analysers.forEach((a: any) => expect(a.connections).toEqual([]));
    // AC 2.4.4: every node the tap made was disconnected (the analysers too, edge or not).
    [upmix, splitter, ...analysers].forEach((n: any) => expect(n.disconnected).toBeGreaterThan(0));
    const made = [upmix, splitter, ...analysers];
    const counts = [source.disconnected, ...made.map((n: any) => n.disconnected)];
    tap.close();
    expect([source.disconnected, ...made.map((n: any) => n.disconnected)]).toEqual(counts);
    expect(tap.read().peakDb).toEqual([-Infinity, -Infinity]);
  });

  it('10 open/close cycles leave the source with only its own edge', async () => {
    const { openLevelMeter } = await load();
    const source = ac.createGain();
    source.connect(ac.destination);
    for (let i = 0; i < 10; i++) openLevelMeter(ac, source).close();
    expect(source.connections).toEqual([ac.destination]);
    expect(ac.createdNodes.filter((n: any) => n.connections.length > 0)).toEqual([source]);
  });
});

describe('resolveMeterSource and following the main output', () => {
  it('prefers the main EQ output, then destinationGain, then null', async () => {
    const { resolveMeterSource } = await load();
    const eq = ac.createGain();
    expect(resolveMeterSource(ac, { eqTap: () => eq, destinationGain: () => destinationGain })).toBe(eq);
    expect(resolveMeterSource(ac, { eqTap: () => null, destinationGain: () => destinationGain })).toBe(destinationGain);
    expect(resolveMeterSource(ac, { eqTap: () => null, destinationGain: () => null })).toBe(null);
  });

  it('by default: the installed main EQ output, else destinationGain once audio runs, else null', async () => {
    const { resolveMeterSource, initMainEqualizer, getMainEqualizerOutputTap } = await load();
    ac.state = 'suspended'; // audio not started: superdough's controller is not read
    expect(resolveMeterSource(ac)).toBe(null);
    ac.state = 'running';
    expect(resolveMeterSource(ac)).toBe(destinationGain);
    initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    expect(resolveMeterSource(ac)).toBe(getMainEqualizerOutputTap());
  });

  it('skips a node of another AudioContext (the preview engine)', async () => {
    const { resolveMeterSource } = await load();
    const other = Object.assign(new MockAudioContext().createGain(), { context: {} });
    expect(resolveMeterSource(ac, { eqTap: () => other, destinationGain: () => destinationGain })).toBe(
      destinationGain,
    );
  });

  it('without a source: reads silence before audio, then follows the main EQ as it appears and goes', async () => {
    const { openLevelMeter, initMainEqualizer, destroyMainEqualizer, getMainEqualizerOutputTap } = await load();
    ac.state = 'suspended';
    const tap = openLevelMeter(ac);
    const [splitter] = nodesOf('ChannelSplitter');
    const upmix = splitterFeeder(splitter);
    expect(tap.read().peakDb).toEqual([-Infinity, -Infinity]);
    expect(destinationGain.connections).toEqual([]);

    ac.state = 'running';
    initMainEqualizer(ac, { setOutputInsert: vi.fn() });
    const eqOut: any = getMainEqualizerOutputTap();
    expect(eqOut.connections).toContain(upmix);

    destroyMainEqualizer(); // EQ gone: back to destinationGain
    expect(eqOut.connections).not.toContain(upmix);
    expect(destinationGain.connections).toEqual([upmix]);

    tap.close();
    expect(destinationGain.connections).toEqual([]);
    initMainEqualizer(ac, { setOutputInsert: vi.fn() }); // closed: no longer follows
    expect((getMainEqualizerOutputTap() as any).connections).not.toContain(upmix);
  });
});

describe('following the main output across a destinationGain reset (spec 030 review #4)', () => {
  it('re-resolves in read() at about 4 Hz: the old edge goes, the new destinationGain feeds the upmix', async () => {
    const { openLevelMeter, METER_RESOLVE_INTERVAL_MS } = await load();
    let t = 0;
    let gain = destinationGain;
    const tap = openLevelMeter(ac, null, { eqTap: () => null, destinationGain: () => gain, now: () => t });
    const upmix = splitterFeeder(nodesOf('ChannelSplitter')[0]);
    expect(gain.connections).toEqual([upmix]);

    const old = gain;
    gain = ac.createGain(); // resetGlobalEffects(): a new destinationGain, no event
    t = METER_RESOLVE_INTERVAL_MS - 1;
    tap.read();
    expect(old.connections).toEqual([upmix]); // throttled: not yet
    t = METER_RESOLVE_INTERVAL_MS;
    tap.read();
    expect(old.connections).toEqual([]);
    expect(gain.connections).toEqual([upmix]);
    expect(upmix.connections).toEqual([nodesOf('ChannelSplitter')[0]]);

    const disconnects = gain.disconnected;
    t += 10 * METER_RESOLVE_INTERVAL_MS;
    tap.read(); // same source: no churn on the edge
    expect(gain.disconnected).toBe(disconnects);
    expect(gain.connections).toEqual([upmix]);
    tap.close();
    expect(gain.connections).toEqual([]);
  });

  it('an explicit source is never re-resolved', async () => {
    const { openLevelMeter } = await load();
    let t = 0;
    const source = ac.createGain();
    const other = ac.createGain();
    const tap = openLevelMeter(ac, source, { eqTap: () => other, now: () => t });
    t = 10_000;
    tap.read();
    expect(other.connections).toEqual([]);
    expect(source.connections).toHaveLength(1);
  });
});

describe('meterBallistics', () => {
  const reading = (l: number, r = l, over = false) => ({
    peakDb: [l, r] as [number, number],
    rmsDb: [l - 3, r - 3] as [number, number],
    over,
  });

  it('holds the peak marker 1500 ms, then falls 20 dB/s', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-6), 16);
    expect(d.holdDb).toEqual([-6, -6]);
    d = meterBallistics(d, reading(-40), 1000);
    expect(d.peakDb).toEqual([-40, -40]);
    expect(d.holdDb).toEqual([-6, -6]);
    d = meterBallistics(d, reading(-40), 500); // 1500 ms: still held
    expect(d.holdDb).toEqual([-6, -6]);
    d = meterBallistics(d, reading(-40), 500); // 0.5 s falling
    expect(d.holdDb[0]).toBeCloseTo(-16, 6);
    d = meterBallistics(d, reading(-40), 600); // straddles nothing: 0.6 s more
    expect(d.holdDb[0]).toBeCloseTo(-28, 6);
    d = meterBallistics(d, reading(-10, -40), 16); // a louder peak catches the left marker
    expect(d.holdDb[0]).toBe(-10);
    expect(d.holdAgeMs[0]).toBe(0);
    expect(d.holdDb[1]).toBeLessThan(-28);
  });

  it('a hold that ends mid-frame falls only for the part after 1500 ms', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-6), 0);
    d = meterBallistics(d, reading(-50), 1400);
    d = meterBallistics(d, reading(-50), 200); // 100 ms held, 100 ms falling
    expect(d.holdDb[0]).toBeCloseTo(-8, 6);
  });

  it('latches the clip light 2000 ms after the last over', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-0.1, -0.1, true), 16);
    expect(d.clip).toBe(true);
    d = meterBallistics(d, reading(-20), 1000);
    d = meterBallistics(d, reading(-0.2, -20, true), 16); // a later over restarts the latch
    d = meterBallistics(d, reading(-20), 1999);
    expect(d.clip).toBe(true);
    d = meterBallistics(d, reading(-20), 1);
    expect(d.clip).toBe(false);
    d = meterBallistics(d, reading(-20), 5000);
    expect(d.clip).toBe(false);
  });

  it('never lights the clip without an over', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-1), 16);
    d = meterBallistics(d, reading(-1), 16);
    expect(d.clip).toBe(false);
    expect(d.clipAgeMs).toBe(Infinity);
  });

  it('floors at −60 dB: quieter reads -Infinity, and a falling marker drops to -Infinity', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-61, -Infinity), 16);
    expect(d.peakDb).toEqual([-Infinity, -Infinity]);
    expect(d.holdDb).toEqual([-Infinity, -Infinity]);
    d = meterBallistics(d, reading(-50), 16);
    d = meterBallistics(d, reading(-Infinity), 1500 + 600); // 0.6 s falling: −62
    expect(d.holdDb).toEqual([-Infinity, -Infinity]);
  });

  it('ignores a negative or non-finite dt', async () => {
    const { meterBallistics } = await load();
    let d = meterBallistics(null, reading(-6, -6, true), 0);
    d = meterBallistics(d, reading(-30), -100);
    d = meterBallistics(d, reading(-30), Number.NaN);
    expect(d.holdDb).toEqual([-6, -6]);
    expect(d.holdAgeMs).toEqual([0, 0]);
    expect(d.clip).toBe(true);
  });
});
