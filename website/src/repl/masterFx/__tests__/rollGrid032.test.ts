/**
 * @spec: 032-master-fx (§2.4 Beat-repeat grid; tech §2.5 rollGrid, §3 risk 1)
 * The slice starts on the last grid line of its length, counted from the playing track's start, at
 * the cycle audible now (the scheduler's cycle minus its latency), in AudioContext seconds.
 */
import { describe, expect, it } from 'vitest';
import { rollGridStart } from '../rollGrid';

const base = { cps: 0.5, latency: 0, ctxTime: 100, originCycle: 0, lengthCycles: 1 / 4 };

describe('rollGridStart', () => {
  it('a press 0.1 s after a quarter-cycle line (cps 0.5) starts the slice on that line, 0.5 s long', () => {
    // Line at cycle 1.25; 0.1 s later at cps 0.5 is cycle 1.3.
    const r = rollGridStart({ ...base, nowCycle: 1.3 })!;
    expect(r.lineCycle).toBeCloseTo(1.25, 9);
    expect(r.startTime).toBeCloseTo(99.9, 9);
    expect(r.lengthSeconds).toBeCloseTo(0.5, 9);
  });

  it('a press exactly on a line starts on that line, not the one before', () => {
    const r = rollGridStart({ ...base, nowCycle: 0.75 })!;
    expect(r.lineCycle).toBeCloseTo(0.75, 9);
    expect(r.startTime).toBeCloseTo(100, 9);
  });

  it('corrects for the scheduler latency: the grid refers to the audible cycle, not the scheduled one', () => {
    // Scheduled cycle 1.3 with 0.1 s latency at cps 0.5: audible is 1.25, exactly on the line.
    const late = rollGridStart({ ...base, nowCycle: 1.3, latency: 0.1 })!;
    expect(late.audibleCycle).toBeCloseTo(1.25, 9);
    expect(late.lineCycle).toBeCloseTo(1.25, 9);
    expect(late.startTime).toBeCloseTo(100, 9);
    // Negative pair: ignoring the latency would put the line 0.1 s earlier.
    const naive = rollGridStart({ ...base, nowCycle: 1.3 })!;
    expect(naive.startTime).not.toBeCloseTo(late.startTime, 6);
  });

  it('counts from the track origin (Snap), not the global grid', () => {
    // Track started at cycle 10.1 on the scheduler grid; audible 10.5 → 0.4 cycles in → line 10.35.
    const r = rollGridStart({ ...base, nowCycle: 10.5, originCycle: 10.1 })!;
    expect(r.lineCycle).toBeCloseTo(10.35, 9);
    expect(r.startTime).toBeCloseTo(100 - 0.15 / 0.5, 9);
    // Negative pair: origin 0 lands on 10.5 itself.
    expect(rollGridStart({ ...base, nowCycle: 10.5 })!.lineCycle).toBeCloseTo(10.5, 9);
  });

  it('each length has its own grid (1/2, 1/8, 1/16)', () => {
    expect(rollGridStart({ ...base, nowCycle: 1.3, lengthCycles: 1 / 2 })!.lineCycle).toBeCloseTo(1, 9);
    expect(rollGridStart({ ...base, nowCycle: 1.3, lengthCycles: 1 / 8 })!.lineCycle).toBeCloseTo(1.25, 9);
    expect(rollGridStart({ ...base, nowCycle: 1.3, lengthCycles: 1 / 16 })!.lineCycle).toBeCloseTo(1.25, 9);
    expect(rollGridStart({ ...base, nowCycle: 1.3, lengthCycles: 1 / 2 })!.lengthSeconds).toBeCloseTo(1, 9);
  });

  it('no usable tempo or length: null (the caller rolls from now)', () => {
    expect(rollGridStart({ ...base, nowCycle: 1, cps: 0 })).toBeNull();
    expect(rollGridStart({ ...base, nowCycle: Number.NaN })).toBeNull();
    expect(rollGridStart({ ...base, nowCycle: 1, lengthCycles: 0 })).toBeNull();
  });

  it('Cyclist timing (review 032 #1): a press 20 ms after a heard quarter line picks THAT line', () => {
    // core/cyclist.mjs: ticks every `duration` s at phase p_n = s0 + n·duration, querying from
    // lastBegin = c0 + (p_n − s0)·cps; a hap at cycle c sounds at (c − c0)/cps + s0 + latency;
    // now() = lastBegin + (t − lastTick − duration)·cps.
    const cps = 0.5;
    const duration = 0.05;
    const latency = 0.1;
    const s0 = 10;
    const c0 = 0;
    const heardAt = (c: number) => (c - c0) / cps + s0 + latency;
    const line = 1.25;
    const t = heardAt(line) + 0.02; // 20 ms after the line is heard
    const n = Math.floor((t - s0) / duration);
    const lastTick = s0 + n * duration;
    const lastBegin = c0 + (lastTick - s0) * cps;
    const now = lastBegin + (t - lastTick - duration) * cps;
    const r = rollGridStart({
      nowCycle: now,
      cps,
      latency,
      clockDuration: duration,
      ctxTime: t,
      originCycle: 0,
      lengthCycles: 1 / 4,
    })!;
    expect(r.lineCycle).toBeCloseTo(line, 9);
    expect(r.startTime).toBeCloseTo(heardAt(line), 9);
  });

  it('NeoCyclist (sync) has no clock duration: absent means 0', () => {
    // neocyclist.mjs: now() = cycle + (t − tickTime)·cps; a hap at c sounds at tickTime + (c − cycle)/cps + latency.
    const cps = 0.5;
    const latency = 0.1;
    const tickTime = 20;
    const cycle = 4;
    const heardAt = (c: number) => tickTime + (c - cycle) / cps + latency;
    const t = heardAt(4.25) + 0.02;
    const r = rollGridStart({
      nowCycle: cycle + (t - tickTime) * cps,
      cps,
      latency,
      ctxTime: t,
      originCycle: 0,
      lengthCycles: 1 / 4,
    })!;
    expect(r.lineCycle).toBeCloseTo(4.25, 9);
    expect(r.startTime).toBeCloseTo(heardAt(4.25), 9);
  });
});
