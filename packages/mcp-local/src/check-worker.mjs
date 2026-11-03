// The check of the online tool, with its own list of names: bundled, so that nothing of the Worker
// package is needed at run time. It parses the code and never runs it.
import { parentPort, workerData } from 'node:worker_threads';
import { checkCode } from '../../mcp-worker/src/check.ts';
import known from '../../mcp-worker/src/generated/known.json';

parentPort.postMessage(JSON.stringify({ ok: true, result: checkCode(workerData.code, new Set(known)) }));
