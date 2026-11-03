/*
@spec: 018-strudel-mcp-server
@regression
The helper as a user gets it: built, packed, unpacked outside the repo and driven through the SDK's
stdio client, so each test also proves the published files are complete. Every server is its own
process, which keeps it clear of the suite's isolate:false shared module state.

STRUDEL_MCP_TEST_NPX=1 replaces the unpacked copy with a real `npx --package <tarball> strudel-mcp`,
which installs the dependencies from the registry.
*/
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFile = promisify(execFileCallback);
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const SECRET = `secret-${process.pid}-c0ffee`;
const REAL_LIMIT_BOUND_MS = 10_000;

// Generous for a loaded 2-vCPU CI runner: the limits under test have their own, tighter bounds.
const TIMEOUT = { timeout: 60_000 };

let workDir;
let cliPath;
let tarballPath;
let manifest;
let secretFile;
let server;
let shortLimitServer;

async function packTarball() {
  const { stdout } = await execFile('pnpm', ['pack', '--pack-destination', workDir], {
    cwd: packageDir,
    maxBuffer: 16 * 1024 * 1024,
  });
  tarballPath = stdout
    .trim()
    .split('\n')
    .find((line) => line.endsWith('.tgz'));
  const unpacked = join(workDir, 'unpacked');
  await mkdir(unpacked);
  await execFile('tar', ['-xzf', tarballPath, '-C', unpacked]);
  const root = join(unpacked, 'package');
  manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // Only what the published manifest declares, so an undeclared import fails here as it would for a user.
  for (const name of Object.keys(manifest.dependencies)) {
    const link = join(root, 'node_modules', name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(await realpath(join(packageDir, 'node_modules', name)), link);
  }
  return join(root, manifest.bin['strudel-mcp']);
}

async function connect(cliPath, env = {}) {
  const fullEnv = { ...getDefaultEnvironment(), STRUDEL_TEST_SECRET: SECRET, ...env };
  const params = process.env.STRUDEL_MCP_TEST_NPX
    ? { command: 'npx', args: ['--yes', '--package', tarballPath, 'strudel-mcp'] }
    : { command: process.execPath, args: [cliPath] };
  const client = new Client({ name: 'strudel-mcp-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ ...params, cwd: workDir, env: fullEnv, stderr: 'ignore' }));
  return client;
}

const call = (client, name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
const run = (code, cycles, client = server) =>
  call(client, 'run_pattern', cycles === undefined ? { code } : { code, cycles });
const errorOf = (result) => {
  expect(result.isError).toBe(true);
  return JSON.parse(result.content[0].text);
};

beforeAll(async () => {
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'strudel-mcp-test-')));
  secretFile = join(workDir, 'secret.txt');
  await writeFile(secretFile, SECRET);
  cliPath = await packTarball();
  server = await connect(cliPath);
  shortLimitServer = await connect(cliPath, { STRUDEL_MCP_TIME_LIMIT_MS: '1200' });
}, 300_000);

afterAll(async () => {
  await server?.close();
  await shortLimitServer?.close();
  await rm(workDir, { recursive: true, force: true });
});

describe('the published package', TIMEOUT, () => {
  it('has the name, license, engines and bin the spec asks for', () => {
    expect(manifest).toMatchObject({
      name: '@dygy/strudel-mcp',
      license: 'AGPL-3.0-or-later',
      engines: { node: '>=20' },
      bin: { 'strudel-mcp': expect.any(String) },
    });
    expect(JSON.stringify(manifest)).not.toContain('workspace:');
    expect(Object.keys(manifest.dependencies)).toContain('quickjs-emscripten');
    expect(Object.keys(manifest.dependencies).filter((name) => name.startsWith('@strudel/'))).toEqual([]);
  });

  it('ships the license and the notices for the code it bundles', async () => {
    const root = join(workDir, 'unpacked', 'package');
    expect(await readFile(join(root, 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    const host = await readFile(join(root, 'dist', 'THIRD-PARTY-NOTICES.host.txt'), 'utf8');
    const guest = await readFile(join(root, 'dist', 'THIRD-PARTY-NOTICES.guest.txt'), 'utf8');
    expect(host).toContain('acorn');
    expect(host).toContain('escodegen');
    expect(guest).toContain('@tonaljs');
    expect(guest).toContain('fraction.js');
  });
});

describe('the tools', TIMEOUT, () => {
  it('lists exactly run_pattern and summarize_pattern, read-only, with input and output schemas', async () => {
    const { tools } = await server.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['run_pattern', 'summarize_pattern']);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool.inputSchema.properties.code).toBeDefined();
      expect(tool.inputSchema.properties.cycles).toMatchObject({ default: 4, maximum: 64 });
      expect(tool.outputSchema.type).toBe('object');
    }
  });

  it('s("bd sd") for 2 cycles gives 4 events with times and lists both sounds', async () => {
    const result = await run('s("bd sd")', 2);
    expect(result.isError).toBeFalsy();
    const { events, truncated, summary, cycles } = result.structuredContent;
    expect(cycles).toBe(2);
    expect(truncated).toBe(false);
    expect(events).toEqual([
      { start: 0, end: 0.5, startFraction: '0', endFraction: '1/2', values: { s: 'bd' } },
      { start: 0.5, end: 1, startFraction: '1/2', endFraction: '1', values: { s: 'sd' } },
      { start: 1, end: 1.5, startFraction: '1', endFraction: '3/2', values: { s: 'bd' } },
      { start: 1.5, end: 2, startFraction: '3/2', endFraction: '2', values: { s: 'sd' } },
    ]);
    expect(summary.sounds).toEqual(['bd', 'sd']);
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it('defaults to 4 cycles and refuses more than 64', async () => {
    const result = await run('s("bd")');
    expect(result.structuredContent.events).toHaveLength(4);
    const tooMany = await run('s("bd")', 65);
    expect(tooMany.isError).toBe(true);
    expect(tooMany.content[0].text).toMatch(/64/);
    expect((await run('s("bd")', 64)).structuredContent.events).toHaveLength(64);
  });

  it('summarize_pattern gives sounds, events per cycle and the note range, without the events', async () => {
    const result = await call(server, 'summarize_pattern', {
      code: `$: s("bd*2")\n$: note("c3 <e4 g2>").s("piano")`,
      cycles: 2,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.events).toBeUndefined();
    expect(result.structuredContent).toEqual({
      cycles: 2,
      cps: 0.5,
      sounds: ['bd', 'piano'],
      totalEvents: 8,
      eventsPerCycle: [4, 4],
      averageEventsPerCycle: 4,
      noteRange: { low: 'g2', high: 'e4', lowMidi: 43, highMidi: 64 },
      cyclesCounted: 2,
      truncated: false,
      skipped: [],
    });
  });

  it('counts a note with no sound as the triangle the browser plays', async () => {
    const result = await call(server, 'summarize_pattern', { code: 'note("c3")', cycles: 1 });
    expect(result.structuredContent.sounds).toEqual(['triangle']);
  });

  it('names a banked sound as the browser resolves it', async () => {
    const result = await call(server, 'summarize_pattern', { code: 's("bd").bank("tr808")', cycles: 1 });
    expect(result.structuredContent.sounds).toEqual(['tr808_bd']);
  });
});

describe('errors', TIMEOUT, () => {
  it('a syntax error returns its line and column, and the server carries on', async () => {
    const error = errorOf(await run('s("bd")\n  .fast(2)\nlet = = 3'));
    expect(error).toMatchObject({ code: 'syntax_error', line: 3, column: 7 });
    expect(error.message).toMatch(/Unexpected token/);
    expect((await run('s("bd sd")', 2)).structuredContent.events).toHaveLength(4);
  });

  it('a mini-notation error returns the line of its string', async () => {
    const error = errorOf(await run('stack(\n  s("bd"),\n  s("sd [hh")\n)'));
    expect(error).toMatchObject({ code: 'syntax_error', line: 3 });
    expect(error.message).toMatch(/mini/);
  });

  it('an unknown function returns its line in the source, not in the generated code', async () => {
    const error = errorOf(await run('// a comment\n\n$: s("bd")\n\n$: nosuch("hh")'));
    expect(error).toMatchObject({ code: 'runtime_error', line: 5, column: 4 });
    expect(error.message).toContain('nosuch');
  });

  it('a misspelled method in a long chain returns the line of that method and its name', async () => {
    const error = errorOf(await run('s("bd")\n  .fast(2)\n  .lowpas(300)\n  .room(1)'));
    expect(error).toMatchObject({ code: 'runtime_error', line: 3, column: 4 });
    expect(error.message).toContain('lowpas');
  });

  it('an error thrown when queried returns its line rather than an empty answer', async () => {
    const error = errorOf(await run('s("bd")\n  .withValue(() => {\n    throw new Error(\'boom\');\n  })'));
    expect(error.code).toBe('runtime_error');
    expect(error.message).toContain('boom');
    expect(error.line).toBe(1);
  });

  it('code that makes no pattern is told so', async () => {
    const error = errorOf(await run('1 + 1;\n2 + 2'));
    expect(error).toMatchObject({ code: 'not_a_pattern', line: 2 });
  });

  it('a statement that cannot be the last one returns its line', async () => {
    expect(errorOf(await run('s("bd")\nconst x = 1'))).toMatchObject({ code: 'syntax_error', line: 2 });
  });

  it('a promise that never resolves is an error, not a hang', async () => {
    const error = errorOf(await run('await new Promise(() => {});\ns("bd")'));
    expect(error.code).toBe('never_finished');
  });

  it('an odd thrown value still gives a readable error', async () => {
    expect(errorOf(await run('throw null')).code).toBe('syntax_error');
    expect(errorOf(await run('(() => { throw null })()')).code).toBe('runtime_error');
    const hostile = errorOf(await run('(() => { throw { get message() { throw 1 } } })()'));
    expect(hostile.code).toBe('runtime_error');
  });
});

describe('the time limit', TIMEOUT, () => {
  it('a bare while(true){} is refused like in the browser, whose transpiler needs a last expression', async () => {
    const started = performance.now();
    const error = errorOf(await run('while(true){}'));
    expect(error).toMatchObject({ code: 'syntax_error', line: 1, column: 1 });
    expect(error.message).toContain('last statement');
    expect(performance.now() - started).toBeLessThan(REAL_LIMIT_BOUND_MS);
    expect((await run('s("bd sd")', 2)).structuredContent.events).toHaveLength(4);
  });

  it('while(true){} that really runs stops within 10 s, even if the environment asks for longer, and the next run works', async () => {
    const client = await connect(cliPath, { STRUDEL_MCP_TIME_LIMIT_MS: '600000' });
    try {
      const started = performance.now();
      const error = errorOf(await run('while(true){}\ns("bd")', 1, client));
      expect(performance.now() - started).toBeLessThan(REAL_LIMIT_BOUND_MS);
      expect(error.code).toBe('time_limit');
      expect(error.message).toMatch(/too long/);
      expect((await run('s("bd sd")', 2, client)).structuredContent.events).toHaveLength(4);
    } finally {
      await client.close();
    }
  });

  it.each([
    ['a loop a catch cannot survive', 'while(true){ try { while(true){} } catch (e) {} }\ns("bd")'],
    ['a loop after an await', 'await 1;\nwhile(true){}\ns("bd")'],
    ['a loop inside a query', 's("bd").withValue(() => { while(true){} })'],
    ['a regular expression that never ends', `/^(a+)+$/.test('a'.repeat(64) + '!')`],
    // no interrupt check inside this native call: only killing the worker stops it
    ['a native call that never ends', `'a'.repeat(4e6).indexOf('a'.repeat(2e6) + 'b')\ns("bd")`],
    ['an await loop that never ends', 'await (async () => { for (;;) await 0 })();\ns("bd")'],
  ])('stops %s, and the next run works', async (_name, code) => {
    const started = performance.now();
    const error = errorOf(await run(code, 1, shortLimitServer));
    expect(error.code).toBe('time_limit');
    expect(performance.now() - started).toBeLessThan(6_000);
    expect((await run('s("bd")', 1, shortLimitServer)).structuredContent.events).toHaveLength(1);
  });
});

describe('the memory limit', TIMEOUT, () => {
  it('stops code that eats memory, and the next run works', async () => {
    const error = errorOf(await run('const a = []; while (true) a.push(new Array(1e6).fill(0));\ns("bd")'));
    expect(error.code).toBe('memory_limit');
    expect((await run('s("bd")', 1)).structuredContent.events).toHaveLength(1);
  });

  it('the limit is ours, not just the end of what WebAssembly can address', async () => {
    const allocate = (megabytes) => `const big = 'x'.repeat(${megabytes} * 1024 * 1024);\ns("bd")`;
    expect(errorOf(await run(allocate(300), 1)).code).toBe('memory_limit');
    expect((await run(allocate(150), 1)).structuredContent.events).toHaveLength(1);
  });

  it('deep recursion is an error, not a crash', async () => {
    const error = errorOf(await run('const f = () => f() + 1; f()'));
    expect(error.code).toBe('runtime_error');
    expect((await run('s("bd")', 1)).structuredContent.events).toHaveLength(1);
  });

  it('an answer too large to send is refused', async () => {
    const error = errorOf(await run(`const big = 'x'.repeat(1e5); s("bd*200").withValue((v) => ({ ...v, big }))`, 1));
    expect(error.code).toBe('result_too_large');
  });
});

describe('the sandbox', TIMEOUT, () => {
  const answerText = (result) => JSON.stringify(result);

  it.each([
    ['fetch of a file', () => `pure(fetch('file://${secretFile}'))`, /fetch/],
    ['fetch of the network', () => `await fetch('https://example.com')`, /fetch/],
    ['require', () => `pure(require('node:fs').readFileSync('${secretFile}', 'utf8'))`, /require/],
    ['process', () => `pure(process.env.STRUDEL_TEST_SECRET)`, /process/],
    ['process through the Function constructor', () => `Function('return process')()`, /process/],
    ['process through a constructor chain', () => `s('bd').constructor.constructor('return process')()`, /process/],
    ['a dynamic import of fs', () => `await import('node:fs')`, /./],
    ['a dynamic import of a path', () => `await import('${secretFile}')`, /./],
    ['the std module of the qjs shell', () => `std.loadFile('${secretFile}')`, /std/],
    ['the os module of the qjs shell', () => `os.exec(['id'])`, /os/],
    ['XMLHttpRequest', () => `new XMLHttpRequest()`, /XMLHttpRequest/],
    ['WebSocket', () => `new WebSocket('ws://localhost')`, /WebSocket/],
    ['Worker', () => `new Worker('x.js')`, /Worker/],
    ['WebAssembly', () => `WebAssembly.compile(new Uint8Array())`, /WebAssembly/],
  ])('%s fails and leaks nothing', async (_name, makeCode, messagePattern) => {
    const result = await run(makeCode());
    expect(answerText(result)).not.toContain(SECRET);
    expect(answerText(result)).not.toContain(join(workDir, 'unpacked'));
    expect(errorOf(result).message).toMatch(messagePattern);
  });

  it('the code really sees no capability: it can look, and finds nothing', async () => {
    const names = [
      'fetch',
      'require',
      'process',
      'module',
      'exports',
      'Buffer',
      'global',
      'std',
      'os',
      'XMLHttpRequest',
      'WebSocket',
      'Worker',
      'SharedWorker',
      'importScripts',
      'WebAssembly',
      'setTimeout',
      'setInterval',
      'queueMicrotask',
      'navigator',
      'window',
      'document',
      'localStorage',
      'Deno',
      'Bun',
      '__strudelGuest',
    ];
    const probe = JSON.stringify(names).replaceAll('"', "'");
    const result = await run(`pure(JSON.stringify(${probe}.filter((name) => name in globalThis)))`, 1);
    expect(result.structuredContent.events[0].values).toBe('[]');
  });

  it('the engine has no host function hiding in its global scope', async () => {
    const result = await run(
      `pure(Object.getOwnPropertyNames(globalThis)
        .filter((name) => typeof globalThis[name] === 'function' && /native code/.test(String(globalThis[name])))
        .filter((name) => !/^(Object|Function|Array|Number|Boolean|String|Symbol|BigInt|Date|RegExp|Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|InternalError|AggregateError|Iterator|Map|Set|WeakMap|WeakSet|WeakRef|FinalizationRegistry|Promise|Proxy|ArrayBuffer|SharedArrayBuffer|DataView|\\w+Array|parseInt|parseFloat|isNaN|isFinite|decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|escape|unescape|eval)$/.test(name))
        .join())`,
      1,
    );
    expect(result.structuredContent.events[0].values).toBe('');
  });

  it('one run cannot leave anything behind for the next', async () => {
    const dirty = await run(
      `globalThis.left = 'behind'; String.prototype.polluted = 1; Pattern.prototype.fast = null; s("bd")`,
      1,
    );
    expect(dirty.isError).toBeFalsy();
    const clean = await run(`pure(String(typeof left) + String(typeof ''.polluted)).fast(2)`, 1);
    expect(clean.structuredContent.events).toHaveLength(2);
    expect(clean.structuredContent.events[0].values).toBe('undefinedundefined');
  });
});

describe('the event cap', TIMEOUT, () => {
  it('over 2,000 events gives the first 2,000 and says it was cut off', async () => {
    const result = await run('s("bd*1000")', 4);
    const { events, truncated, summary } = result.structuredContent;
    expect(result.isError).toBeFalsy();
    expect(events).toHaveLength(2000);
    expect(truncated).toBe(true);
    expect(events[1999].startFraction).toBe('1999/1000');
    expect(summary).toMatchObject({ totalEvents: 4000, eventsPerCycle: [1000, 1000, 1000, 1000], truncated: true });
    expect(result.content[0].text).toContain('"truncated":true');
  });

  it('exactly 2,000 events is not cut off', async () => {
    const { events, truncated } = (await run('s("bd*500")', 4)).structuredContent;
    expect(events).toHaveLength(2000);
    expect(truncated).toBe(false);
  });

  it('stops counting at a fixed number of events, and the summary says how far it got', async () => {
    const { summary, truncated, events } = (await run('s("bd*20000")', 64)).structuredContent;
    expect(truncated).toBe(true);
    expect(events).toHaveLength(2000);
    expect(summary.cyclesCounted).toBe(1);
    expect(summary.totalEvents).toBe(20_000);
    expect(summary.eventsPerCycle).toHaveLength(summary.cyclesCounted);
  });
});

describe('loaders and things with no effect on events', TIMEOUT, () => {
  it('samples() and other loaders are stubs, reported as skipped', async () => {
    const result = await run(
      `samples('github:tidalcycles/dirt-samples');
await aliasBank('https://example.com/a.json');
soundAlias('bd', 'kick');
await initHydra();
s("bd")`,
      1,
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.events).toHaveLength(1);
    expect(result.structuredContent.skipped).toEqual(['aliasBank', 'initHydra', 'samples', 'soundAlias']);
  });

  it('visual and output methods leave the events alone and are reported as skipped', async () => {
    const plain = await run('s("bd sd")', 2);
    const result = await run('s("bd sd").pianoroll({ labels: 1 }).scope().midi().osc().fast(1)', 2);
    expect(result.structuredContent.events).toEqual(plain.structuredContent.events);
    expect(result.structuredContent.skipped).toEqual(['midi', 'osc', 'pianoroll', 'scope']);
  });

  it('a slider, a toggle and a radio use the value in the code, like the browser before any drag', async () => {
    const result = await run('note("c3").gain(slider(0.5, 0, 1)).pan(toggle(1)).room(radio(0.25, 0.75))', 1);
    expect(result.structuredContent.events[0].values).toEqual({ note: 'c3', gain: 0.5, pan: 1, room: 0.25 });
    expect(result.structuredContent.skipped).toEqual(['radio', 'slider', 'toggle']);
  });
});

describe('parity with the real engine', TIMEOUT, () => {
  const tunes = [
    { code: 's("bd sd")', cycles: 2 },
    { code: 's("bd*2 [sd hh] ~ <cp rim>")', cycles: 8 },
    { code: 'note("c3 <e3 g3> [a3 c4]/2")', cycles: 8 },
    { code: 's("bd:3 sd:1").n("<0 1>")', cycles: 4 },
    { code: 'note("c3(3,8,<0 2>)")', cycles: 4 },
    { code: 'n("0 2 4 <6 7>").scale("C:minor")', cycles: 8 },
    { code: 'n("0 .. 7").scale("<D:dorian A:phrygian>").slow(2)', cycles: 8 },
    { code: 'note("c e g").slow(3)', cycles: 6 },
    { code: 'note("c e g b").slow(1.5)', cycles: 6 },
    { code: 'chord("<Am7 C^7 F>").voicing()', cycles: 6 },
    { code: 'note("c3").add(note("<0 7 12>")).transpose("<0 2>")', cycles: 6 },
    {
      code: '$: s("bd*4")\n$: note("c3 e3").slow(2)',
      direct: 'stack(s(mini("bd*4")), note(mini("c3 e3")).slow(2))',
      cycles: 4,
    },
    {
      code: '$: s("hh*8")\n_$: s("bd")\nmuted_: s("cp")\n$: n("0 2").scale("C:major").slow(3)',
      direct: 'stack(s(mini("hh*8")), n(mini("0 2")).scale(mini("C:major")).slow(3))',
      cycles: 6,
    },
    {
      code: 'drums: s("bd*2")\nbass: note("c2").slow(2)',
      direct: 'stack(s(mini("bd*2")), note(mini("c2")).slow(2))',
      cycles: 4,
    },
    {
      code: `s("bd").p('a'); s("sd").p('b'); s("hh").p('a')`,
      direct: 'stack(s(mini("hh")), s(mini("sd")))',
      cycles: 2,
    },
    // the transpiler makes "a" a pattern, not a name, so every double-quoted id is the same key
    { code: 's("bd").p("a"); s("sd").p("b")', direct: 's(mini("sd"))', cycles: 2 },
    { code: 's("bd").d1; s("sd").p2', direct: 'stack(s(mini("bd")), s(mini("sd")))', cycles: 2 },
    { code: '$: s("bd*2")\n$: s("hh*4")\nall(x => x.fast(2))', cycles: 2 },
    { code: '$: s("bd*2")\n$: s("hh*4")\neach(x => x.rev())', cycles: 2 },
    { code: 'hush(); s("bd")', cycles: 2 },
    { code: 'setcps(0.7);\ns("breaks165").loopAt(2).chop(4)', cycles: 4 },
    { code: 'setcpm(120);\ns("breaks165").fit().slice(4, "0 1 2 3")', cycles: 2 },
    { code: 's("bd*2").cpm(30)', cycles: 4 },
    { code: 's("bd").jux(rev).off(1/8, x => x.speed(2))', cycles: 2 },
    { code: 'note("c a f e").struct("x(5,8)").every(3, fast(2))', cycles: 6 },
    { code: 's("hh*16").degradeBy(0.4)', cycles: 8 },
    { code: 's("hh*8").sometimes(x => x.speed(2)).rarely(ply(2))', cycles: 8 },
    { code: 's("hh*8").lpf(rand.range(200, 2000)).pan(perlin.range(0, 1))', cycles: 8 },
    { code: 'n(irand(8).segment(4)).scale("C:minor")', cycles: 8 },
    { code: 's("bd*4").gain(sine.range(0.2, 1)).pan(saw.fast(2))', cycles: 4 },
    { code: 'note("[c,e,g]*<2 3>").arp("0 2 1").swingBy(1/3, 4)', cycles: 4 },
  ];
  let answers;

  beforeAll(async () => {
    const oracle = join(packageDir, 'test', 'fixtures', 'real-engine.mjs');
    answers = await new Promise((resolve, reject) => {
      const child = execFileCallback(
        process.execPath,
        [oracle],
        { cwd: packageDir, maxBuffer: 256 * 1024 * 1024 },
        (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
      );
      child.stdin.end(JSON.stringify(tunes));
    });
  }, 120_000);

  const comparable = ({ startFraction, endFraction, values }) => ({ startFraction, endFraction, values });

  it.each(tunes.map((tune, index) => [tune.code, index]))('%s', async (code, index) => {
    const result = await run(code, tunes[index].cycles);
    expect(result.isError).toBeFalsy();
    const { events, cps } = result.structuredContent;
    const expected = answers[index];
    expect(expected.whole.length).toBeGreaterThan(0);
    expect(events.map(comparable)).toEqual(expected.whole);
    expect(events.map(comparable)).toEqual(expected.scheduled);
    if (expected.direct) {
      expect(events.map(comparable)).toEqual(expected.direct);
    }
    expect(cps).toBe(expected.cps);
  });
});
