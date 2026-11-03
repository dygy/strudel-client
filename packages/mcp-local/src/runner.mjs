import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { KILL_GRACE_MS, TIME_LIMIT_MS, WORKER_STACK_MB } from './limits.mjs';

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'worker.mjs');

const stopped = (code, message) => ({ ok: false, error: { code, message } });

function timeLimit() {
  // the environment can only shorten it, so that a config can't turn the promised stop off
  const fromEnv = Number(process.env.STRUDEL_MCP_TIME_LIMIT_MS);
  return fromEnv > 0 ? Math.min(fromEnv, TIME_LIMIT_MS) : TIME_LIMIT_MS;
}

function runInWorker({ code, cycles }) {
  return new Promise((resolve) => {
    const limit = timeLimit();
    const worker = new Worker(WORKER_PATH, {
      workerData: { code, cycles, deadline: Date.now() + limit },
      resourceLimits: { stackSizeMb: WORKER_STACK_MB },
      // the engine logs to the console, and our stdout belongs to the protocol
      stdout: true,
      stderr: true,
      env: {},
    });
    const finish = (outcome) => {
      clearTimeout(killTimer);
      worker.terminate();
      resolve(outcome);
    };
    // A native call can ignore the interrupt handler. This stop can't be ignored.
    const killTimer = setTimeout(
      () => finish(stopped('time_limit', 'The run took too long and was stopped.')),
      limit + KILL_GRACE_MS,
    );
    worker.once('message', (text) => finish(JSON.parse(text)));
    worker.once('error', (err) => {
      if (err.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(stopped('memory_limit', 'The run used too much memory and was stopped.'));
        return;
      }
      process.stderr.write(`strudel-mcp: worker failed: ${err.message}\n`);
      finish(stopped('sandbox_failure', 'The sandbox stopped working during this run.'));
    });
    worker.once('exit', () => finish(stopped('sandbox_failure', 'The sandbox stopped working during this run.')));
  });
}

/**
 * Makes the function that runs patterns, one at a time, each in a new worker thread holding a new
 * QuickJS context. The MCP connection stays responsive during a run, since this thread isn't blocked.
 * @returns {function({code: string, cycles: number}): Promise<object>} resolves to `{ok: true, result}` or `{ok: false, error}`
 */
export function createRunner() {
  let queue = Promise.resolve();
  return (request) => {
    const job = queue.then(() => runInWorker(request));
    queue = job;
    return job;
  };
}
