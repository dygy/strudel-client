import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { CHECK_TIME_LIMIT_MS, KILL_GRACE_MS, READY_MESSAGE, TIME_LIMIT_MS, WORKER_STACK_MB } from './limits.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RUN_WORKER = join(here, 'worker.mjs');
const CHECK_WORKER = join(here, 'check-worker.mjs');
const FAILED = 'The sandbox stopped working during this run.';

const failed = (code, message) => ({ ok: false, error: { code, message } });

function codeBudget() {
  // The environment can only shorten it, so that a config can't turn the promised stop off.
  const fromEnv = Number(process.env.STRUDEL_MCP_TIME_LIMIT_MS);
  return fromEnv > 0 ? Math.min(fromEnv, TIME_LIMIT_MS) : TIME_LIMIT_MS;
}

/**
 * Runs one job in its own worker thread, and ends that thread whatever the job is doing: a native call
 * can ignore QuickJS's interrupt handler.
 * @param {{file: string, workerData: object, limitMs: number, afterReadyMs?: number, tooLong: string}} job
 * `limitMs` counts from now. `afterReadyMs` is the time the code gets once the worker says it has loaded.
 * @returns {Promise<object>} resolves to `{ok: true, result}` or `{ok: false, error}`
 */
function runInWorker({ file, workerData, limitMs, afterReadyMs, tooLong }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const worker = new Worker(file, {
      workerData,
      resourceLimits: { stackSizeMb: WORKER_STACK_MB },
      // the engine logs to the console, and our stdout belongs to the protocol
      stdout: true,
      stderr: true,
      env: {},
    });
    let killTimer;
    const finish = (outcome) => {
      clearTimeout(killTimer);
      worker.terminate();
      resolve(outcome);
    };
    const killAt = (ms) => {
      clearTimeout(killTimer);
      killTimer = setTimeout(() => finish(failed('time_limit', tooLong)), ms + KILL_GRACE_MS);
    };
    killAt(limitMs);
    worker.on('message', (text) => {
      if (text === READY_MESSAGE) {
        killAt(Math.min(afterReadyMs, limitMs - (Date.now() - startedAt)));
        return;
      }
      finish(JSON.parse(text));
    });
    worker.once('error', (err) => {
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(failed('memory_limit', 'The run used too much memory and was stopped.'));
        return;
      }
      process.stderr.write(`strudel-mcp: worker failed: ${err.message}\n`);
      finish(failed('sandbox_failure', FAILED));
    });
    worker.once('exit', () => finish(failed('sandbox_failure', FAILED)));
  });
}

/**
 * Makes the function that runs patterns, one at a time, each in a new worker thread holding a new
 * QuickJS context. The MCP connection stays responsive during a run, since this thread isn't blocked.
 * @returns {function({code: string, cycles: number}): Promise<object>} resolves to `{ok: true, result}` or `{ok: false, error}`
 */
export function createRunner() {
  let queue = Promise.resolve();
  return ({ code, cycles }) => {
    const job = queue.then(() => {
      const budgetMs = codeBudget();
      return runInWorker({
        file: RUN_WORKER,
        workerData: { code, cycles, deadline: Date.now() + TIME_LIMIT_MS, budgetMs },
        limitMs: TIME_LIMIT_MS,
        afterReadyMs: budgetMs,
        tooLong: 'The run took too long and was stopped.',
      });
    });
    queue = job;
    return job;
  };
}

/**
 * Makes the function behind check_code. It runs in a worker so that huge code can't hold up the MCP
 * connection, with a limit of its own: parsing has no reason to obey the run's.
 * @returns {function({code: string}): Promise<object>} resolves to `{ok: true, result}` or `{ok: false, error}`
 */
export function createChecker() {
  return ({ code }) =>
    runInWorker({
      file: CHECK_WORKER,
      workerData: { code },
      limitMs: CHECK_TIME_LIMIT_MS,
      tooLong: 'The check took too long and was stopped.',
    });
}
