// The oracle for the parity test: the real engine on V8, in its own process so that repl()'s
// prototype patches and evalScope()'s globals can't reach the other files of the isolate:false suite.
// Reads [{ code, direct?, cycles }] on stdin and writes the expected events on stdout.
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import { plainValue } from '../../src/guest/values.mjs';

const { evalScope, repl, State, TimeSpan } = core;

const event = (hap) => ({
  startFraction: hap.whole.begin.toFraction(),
  endFraction: hap.whole.end.toFraction(),
  values: plainValue(hap.value),
});
const byStart = (a, b) => a.whole.begin.compare(b.whole.begin);

/** One query over all the cycles, through the public `queryArc`. */
const queryWhole = (pattern, cycles, cps) =>
  pattern
    .queryArc(0, cycles, { _cps: cps, cyclist: 'cyclist' })
    .filter((hap) => hap.hasOnset())
    .sort(byStart)
    .map(event);

/** The windows the scheduler uses: Cyclist asks for 0.05 s at a time. */
const queryLikeScheduler = (pattern, cycles, cps) => {
  const haps = [];
  const step = 0.05 * cps;
  for (let begin = 0, tick = 0; begin < cycles; tick++) {
    const end = Math.min(cycles, (tick + 1) * step);
    haps.push(...pattern.query(new State(new TimeSpan(begin, end), { _cps: cps, cyclist: 'cyclist' })));
    begin = end;
  }
  return haps
    .filter((hap) => hap.hasOnset())
    .sort(byStart)
    .map(event);
};

// Keep stdout for the answer alone: the engine logs through console.log.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

await evalScope(core, mini, tonal);

const input = JSON.parse(await new Response(process.stdin).text());
const answers = [];
for (const { code, direct, cycles } of input) {
  const instance = repl({
    getTime: () => 0,
    defaultOutput: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    transpiler,
  });
  const pattern = await instance.evaluate(code, false);
  if (!pattern) {
    throw new Error(`the oracle could not evaluate: ${code}`);
  }
  const { cps } = instance.scheduler;
  answers.push({
    code,
    cps,
    whole: queryWhole(pattern, cycles, cps),
    scheduled: queryLikeScheduler(pattern, cycles, cps),
    // a hand-written equivalent with no repl() and no transpiler
    direct: direct ? queryWhole(Function(`"use strict";return (${direct})`)(), cycles, cps) : undefined,
  });
}
process.stdout.write(JSON.stringify(answers));
