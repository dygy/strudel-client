import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { MAX_EVENTS } from './limits.mjs';
import { openSandbox } from './sandbox.mjs';
import { lastStatementPosition, locateRuntimeError, transpile } from './transpile.mjs';

const STOP_MESSAGES = {
  time_limit: 'The run took too long and was stopped.',
  memory_limit: 'The run used too much memory and was stopped.',
  never_finished: 'The code waits on a promise that nothing can resolve: the sandbox has no timers or network.',
  result_too_large: `The answer is too large to send, even with at most ${MAX_EVENTS} events.`,
  sandbox_failure: 'The sandbox stopped working during this run.',
};

async function execute({ code, cycles, deadline }) {
  const transpiled = transpile(code);
  if (transpiled.error) {
    return { ok: false, error: transpiled.error };
  }
  const { output } = transpiled;
  const guestSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'guest.js'), 'utf8');
  const sandbox = await openSandbox({ guestSource, deadline });
  const answer = sandbox.run(output, cycles);
  if (answer.stopped) {
    return { ok: false, error: { code: answer.stopped.code, message: STOP_MESSAGES[answer.stopped.code] } };
  }
  if (answer.ok) {
    return { ok: true, result: answer.result };
  }
  if (/instead of pattern/.test(answer.message)) {
    const message = 'The code did not produce a pattern.';
    return { ok: false, error: { code: 'not_a_pattern', message, ...lastStatementPosition(code) } };
  }
  const located = locateRuntimeError({
    code,
    output,
    generatedLine: answer.generatedLine,
    name: answer.name,
    message: answer.message,
    unknownNames: sandbox.unknownNames,
  });
  return { ok: false, error: { code: 'runtime_error', ...located } };
}

// The only channel to the main thread, and its contents are plain text and numbers.
parentPort.postMessage(JSON.stringify(await execute(workerData)));
