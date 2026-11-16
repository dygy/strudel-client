/**
 * The beat-repeat grid (spec 032 §2.4, tech §2.5): where a roll's slice starts, in AudioContext
 * seconds. Pure, so the maths is tested without a scheduler.
 *
 * The grid is the one Snap uses (specs 023/027): lines every `lengthCycles` counted from the playing
 * track's cycle 0 on the scheduler grid (`originCycle`: the transition controller's origin plus the
 * speakers' scratch shift), at the scheduler's tempo.
 *
 * The cycle audible now, from the scheduler's own timing (review 032 #1):
 * - core's Cyclist: `now()` is the cycle at `t − clock.duration` on its scheduling timeline, and a hap at
 *   cycle c sounds `latency` s after its place on that timeline (cyclist.mjs: targetTime =
 *   (c − c0)/cps + s0 + latency). So the cycle heard at t is `now() + (clock.duration − latency) × cps`.
 * - NeoCyclist (sync on): `now()` is the cycle at t itself and a hap sounds `latency` s after it, so the
 *   heard cycle is `now() − latency × cps`. It has no `clock`, so `clockDuration` is absent there: 0.
 * The slice starts at the last grid line at or before the heard cycle.
 */

export interface RollGridInput {
  /** The scheduler's cycle now (Cyclist.now()). */
  nowCycle: number;
  /** The scheduler's tempo, cycles per second. */
  cps: number;
  /** The scheduler's latency in seconds (Cyclist.latency): scheduled now is heard this much later. */
  latency: number;
  /**
   * Cyclist's `clock.duration` (s): its `now()` lags the clock by this much. Absent or not a positive
   * number (NeoCyclist): 0.
   */
  clockDuration?: number;
  /** AudioContext.currentTime now. */
  ctxTime: number;
  /** Where the playing track's cycle 0 sits on the scheduler grid. */
  originCycle: number;
  /** The slice length in cycles (1/2, 1/4, 1/8, 1/16). */
  lengthCycles: number;
}

export interface RollGridResult {
  /** The cycle audible now. */
  audibleCycle: number;
  /** The last grid line at or before it (scheduler cycles). */
  lineCycle: number;
  /** When that line sounded, in AudioContext seconds (≤ ctxTime). */
  startTime: number;
  /** The slice length in seconds at this tempo. */
  lengthSeconds: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The roll's start: the last `lengthCycles` grid line counted from `originCycle`, at the cycle audible
 * now. Null when the tempo, length or times aren't usable (the caller rolls from now instead).
 */
export function rollGridStart(input: RollGridInput): RollGridResult | null {
  const { nowCycle, cps, ctxTime, lengthCycles } = input;
  if (!finite(nowCycle) || !finite(cps) || cps <= 0 || !finite(ctxTime) || !finite(lengthCycles)) return null;
  if (lengthCycles <= 0) return null;
  const latency = finite(input.latency) && input.latency > 0 ? input.latency : 0;
  const origin = finite(input.originCycle) ? input.originCycle : 0;
  const clockDuration = finite(input.clockDuration) && input.clockDuration > 0 ? input.clockDuration : 0;
  const audibleCycle = nowCycle + (clockDuration - latency) * cps;
  // 1e-9: a press exactly on a line (in float) starts on that line, not the one before.
  const lineCycle = origin + Math.floor((audibleCycle - origin) / lengthCycles + 1e-9) * lengthCycles;
  const startTime = ctxTime - Math.max(0, audibleCycle - lineCycle) / cps;
  return { audibleCycle, lineCycle, startTime, lengthSeconds: lengthCycles / cps };
}
