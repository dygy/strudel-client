import { newQuickJSWASMModule, RELEASE_SYNC } from 'quickjs-emscripten';
import { MAX_RESULT_CHARS, MEMORY_LIMIT_BYTES, QUICKJS_STACK_BYTES } from './limits.mjs';
import { stopForError, stopWithoutAnswer } from './stop.mjs';

// Function() wraps its body in two extra lines inside QuickJS.
const FUNCTION_WRAPPER_LINES = 2;

/**
 * Opens a fresh QuickJS context holding the engine. The only things passed in are the strings and
 * numbers of each call: no host function is ever given to the sandbox. The interrupt handler and the
 * limits belong to the runtime, outside anything the code can reach.
 * Nothing is disposed: the worker this runs in ends with the run.
 * @param {{guestSource: string, deadline: number, budgetMs: number}} options the bundle, the time by which everything must stop, and how long the code itself may run once the engine has loaded
 * @returns {Promise<{run: function(string, number): object, unknownNames: function(string[]): string[]}>} the sandbox
 */
export async function openSandbox({ guestSource, deadline: lastDeadline, budgetMs }) {
  let deadline = lastDeadline;
  let interrupted = false;
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC);
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(QUICKJS_STACK_BYTES);
  runtime.setInterruptHandler(() => {
    interrupted ||= Date.now() >= deadline;
    return interrupted;
  });
  const context = runtime.newContext();

  const unwrap = (result) => {
    if (result.error) {
      const error = dumpError(result.error);
      throw Object.assign(new Error(error.message), { guestError: error });
    }
    return result.value;
  };
  const dumpError = (handle) => {
    try {
      const { name, message } = context.dump(handle);
      return { name: String(name), message: String(message) };
    } catch {
      return { name: 'Error', message: 'unreadable error' };
    }
  };

  unwrap(context.evalCode(guestSource, 'guest.js'));
  const guest = context.getProp(context.global, '__strudelGuest');
  unwrap(context.evalCode('delete globalThis.__strudelGuest', 'guest.js'));
  // Loading can leave scope assignments queued, and those must be done before user code runs.
  unwrap(runtime.executePendingJobs());

  const readOutcome = () => {
    const handle = unwrap(context.callFunction(context.getProp(guest, 'outcome'), guest));
    if (context.typeof(handle) !== 'string') {
      return { done: false };
    }
    const length = context.getNumber(context.getProp(handle, 'length'));
    return length > MAX_RESULT_CHARS ? { done: true, tooLarge: true } : { done: true, text: context.getString(handle) };
  };

  const stopReason = (message) => stopForError({ interrupted, message });
  deadline = Math.min(lastDeadline, Date.now() + budgetMs);

  const run = (code, cycles) => {
    try {
      unwrap(
        context.callFunction(context.getProp(guest, 'run'), guest, context.newString(code), context.newNumber(cycles)),
      );
      // Run the promise jobs until the guest has its answer. A run with no jobs left and no answer is
      // waiting on a promise nothing can resolve, since the sandbox has no timers or I/O.
      for (;;) {
        const jobs = runtime.executePendingJobs(1024);
        const outcome = readOutcome();
        if (outcome.done) {
          if (outcome.tooLarge) {
            return { stopped: { code: 'result_too_large' } };
          }
          const answer = JSON.parse(outcome.text);
          if (answer.ok) {
            return answer;
          }
          const stopped = stopReason(answer.message);
          if (stopped) {
            return { stopped };
          }
          const { functionLine } = answer;
          return { ...answer, generatedLine: functionLine === null ? null : functionLine - FUNCTION_WRAPPER_LINES };
        }
        if (jobs.error) {
          const { message } = dumpError(jobs.error);
          return { stopped: stopReason(message) ?? { code: 'sandbox_failure' } };
        }
        const stopped = stopWithoutAnswer({
          interrupted,
          jobsPending: jobs.value,
          pastDeadline: Date.now() >= deadline,
        });
        if (stopped) {
          return { stopped };
        }
      }
    } catch (err) {
      const stopped = err.guestError && stopReason(err.guestError.message);
      if (stopped) {
        return { stopped };
      }
      throw err;
    }
  };

  return {
    run,
    unknownNames(names) {
      try {
        const result = unwrap(
          context.callFunction(context.getProp(guest, 'unknownNames'), guest, context.newString(JSON.stringify(names))),
        );
        return JSON.parse(context.getString(result));
      } catch {
        // only used to improve an error message, which already has its statement's line
        return [];
      }
    },
  };
}
