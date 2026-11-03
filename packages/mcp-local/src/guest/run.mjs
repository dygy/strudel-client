import { MAX_COUNTED_EVENTS, MAX_EVENTS } from '../limits.mjs';
import { createStubs } from './stubs.mjs';
import { createSummary } from './summary.mjs';
import { plainValue } from './values.mjs';

const MAX_MESSAGE_CHARS = 2_000;

/**
 * The sandbox's side of a pattern run. It only ever answers with strings, so nothing of the guest's
 * object graph reaches the host.
 * @param {{core: object, mini: object, tonal: object}} modules the engine
 * @returns {{run: function(string, number): void, outcome: function(): (string|undefined), unknownNames: function(string): string}} the functions the host calls
 */
export function createGuest({ core, mini, tonal }) {
  const { evalScope, Pattern, repl, State, TimeSpan } = core;
  // taken before user code runs: it can change the globals, which only spoils its own answer
  const { stringify } = JSON;
  const skipped = new Set();
  const scopeReady = evalScope(core, mini, tonal, createStubs(core, skipped));
  let outcome;

  const evaluate = async (code) => {
    let failed = false;
    let evalError;
    // The browser's own repl(), so `$:`, `.p()`, `all`, `each`, `hush` and `setcps` are its code rather
    // than a copy. `code` is already transpiled, on the host, so its "transpiler" passes it through.
    const instance = repl({
      getTime: () => 0,
      defaultOutput: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      transpiler: (transpiled) => ({ output: transpiled }),
      onEvalError: (err) => {
        failed = true;
        evalError = err;
      },
    });
    const pattern = await instance.evaluate(code, false);
    if (failed) {
      throw evalError;
    }
    return { pattern, scheduler: instance.scheduler };
  };

  const collect = (pattern, cycles, cps) => {
    const summary = createSummary(core);
    const events = [];
    const eventsPerCycle = [];
    let totalEvents = 0;
    for (let cycle = 0; cycle < cycles && totalEvents < MAX_COUNTED_EVENTS; cycle++) {
      // What Cyclist schedules: the onsets in a window, with the same controls. `query`, because
      // `queryArc` turns a thrown error into a log line and an empty answer.
      const state = new State(new TimeSpan(cycle, cycle + 1), { _cps: cps, cyclist: 'cyclist' });
      const haps = pattern
        .query(state)
        .filter((hap) => hap.hasOnset())
        .sort((a, b) => a.whole.begin.compare(b.whole.begin));
      for (const hap of haps) {
        const values = plainValue(hap.value);
        summary.add(values);
        if (events.length < MAX_EVENTS) {
          events.push({
            start: Number(hap.whole.begin.valueOf()),
            end: Number(hap.whole.end.valueOf()),
            startFraction: hap.whole.begin.toFraction(),
            endFraction: hap.whole.end.toFraction(),
            values,
          });
        }
      }
      totalEvents += haps.length;
      eventsPerCycle.push(haps.length);
    }
    return { events, eventsPerCycle, totalEvents, summary };
  };

  const execute = async (code, cycles) => {
    await scopeReady;
    const { pattern, scheduler } = await evaluate(code);
    const { cps } = scheduler;
    const { events, eventsPerCycle, totalEvents, summary } = collect(pattern, cycles, cps);
    const truncated = totalEvents > MAX_EVENTS;
    const skippedNames = [...skipped].sort();
    return {
      cycles,
      cps,
      events,
      truncated,
      skipped: skippedNames,
      summary: {
        cycles,
        cps,
        sounds: summary.sounds(),
        totalEvents,
        eventsPerCycle,
        averageEventsPerCycle: eventsPerCycle.length ? totalEvents / eventsPerCycle.length : 0,
        noteRange: summary.noteRange(),
        cyclesCounted: eventsPerCycle.length,
        truncated,
        skipped: skippedNames,
      },
    };
  };

  // The thrown value is user-controlled: it can be null, or have a getter that throws.
  const describeError = (err) => {
    const read = (key) => {
      try {
        return err[key];
      } catch {
        return undefined;
      }
    };
    let message;
    try {
      message = String(read('message') ?? err);
    } catch {
      message = 'Code threw a value that cannot be read';
    }
    const stack = String(read('stack') ?? '');
    // the first frame in code made by Function(), which is how core's evaluate() runs the user's code
    const frame = /<input>:(\d+):(\d+)/.exec(stack);
    return {
      ok: false,
      name: String(read('name') ?? 'Error'),
      message: message.slice(0, MAX_MESSAGE_CHARS),
      functionLine: frame ? Number(frame[1]) : null,
    };
  };

  const finish = (answer) => {
    try {
      outcome = stringify(answer);
    } catch {
      // out of memory, most likely
      outcome = '{"ok":false,"name":"InternalError","message":"out of memory","functionLine":null}';
    }
  };

  return {
    run(code, cycles) {
      execute(code, cycles).then(
        (result) => finish({ ok: true, result }),
        (err) => finish(describeError(err)),
      );
    },
    outcome: () => outcome,
    unknownNames(namesJson) {
      const prototypes = [Pattern, String, Number, Array, Object, Function, Promise].map((type) => type.prototype);
      return stringify(JSON.parse(namesJson).filter((name) => !prototypes.some((proto) => name in proto)));
    },
  };
}
