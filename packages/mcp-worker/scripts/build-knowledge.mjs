#!/usr/bin/env node
/**
 * Writes what the knowledge tools answer from into src/generated (spec 018, tech 2.9). Run from the
 * repo root after `npm run jsdoc-json`, as `pnpm build:mcp` does:
 *
 * - functions.json: `doc.json` (JSDoc of the packages) reduced to name, synonyms, description, params
 *   and examples, the same entries the site's Reference panel lists.
 * - known.json: every name a call may use, for spotting misspellings: those functions, plus what the
 *   packages register without documenting it, plus JavaScript's own methods.
 * - sounds.json: a snapshot of the sounds the site loads at start (`website/src/repl/prebake.ts`), taken
 *   from the sample maps in `website/public`, the sample lists written out in prebake.ts, the General
 *   MIDI names in `packages/soundfonts/gm.mjs`, and the synths registered in `packages/superdough`.
 *   A snapshot: the maps are read from this repo, and sounds a user loads with samples() aren't in it.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/generated');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const plain = (html) =>
  (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** The same filter as the site's Reference panel, so both list the same functions. */
const isListed = (doc) => doc.name && !doc.name.startsWith('_') && !['package'].includes(doc.kind);

export function buildFunctions(docs) {
  const byName = new Map();
  for (const doc of docs.filter(isListed)) {
    if (byName.has(doc.name)) continue;
    byName.set(doc.name, {
      name: doc.name,
      synonyms: doc.synonyms ?? [],
      description: plain(doc.description),
      params: (doc.params ?? []).map((param) => ({
        name: param.name,
        type: param.type?.names?.join(' | ') ?? '',
        description: plain(param.description),
      })),
      examples: doc.examples ?? [],
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const SOURCE_PACKAGES = [
  'core',
  'mini',
  'tonal',
  'webaudio',
  'superdough',
  'draw',
  'transpiler',
  'codemirror',
  'motion',
  'hydra',
  'csound',
  'midi',
  'osc',
  'xen',
  'soundfonts',
  'gamepad',
  'serial',
  'mqtt',
  'mondough',
];

/** Names that the packages make callable, found by reading their source rather than running it. */
export function scanRegisteredNames(source) {
  const names = new Set();
  const add = (text) => {
    for (const [word] of text.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(word);
  };
  for (const [, list] of source.matchAll(/export const \{([^}]*)\}/g)) add(list);
  for (const [, name] of source.matchAll(/export (?:async )?(?:function\*?|const|let|class) ([A-Za-z_$][\w$]*)/g))
    names.add(name);
  for (const [, list] of source.matchAll(/registerControl\(([^)]*)\)/g)) {
    for (const [, name] of list.matchAll(/'([^']+)'/g)) names.add(name);
  }
  for (const [, first] of source.matchAll(/\bregister\(\s*(\[[^\]]*\]|'[^']+')/g)) {
    for (const [, name] of first.matchAll(/'([^']+)'/g)) names.add(name);
  }
  for (const [, name] of source.matchAll(/Pattern\.prototype\.([A-Za-z_$][\w$]*)/g)) names.add(name);
  // Methods of class Pattern, and the `.name = function` form.
  for (const [, name] of source.matchAll(/^ {2}([A-Za-z_$][\w$]*)\([^)]*\) \{$/gm)) names.add(name);
  return names;
}

function buildKnown(functions) {
  const known = new Set();
  for (const fn of functions) {
    known.add(fn.name);
    fn.synonyms.forEach((name) => known.add(name));
  }
  for (const pkg of SOURCE_PACKAGES) {
    const dir = join(ROOT, 'packages', pkg);
    const files = readdirSync(dir).filter((file) => file.endsWith('.mjs') && !file.includes('config'));
    for (const file of files) {
      scanRegisteredNames(readFileSync(join(dir, file), 'utf8')).forEach((name) => known.add(name));
    }
  }
  // What the site adds on top of the packages at start.
  for (const file of ['packages/repl/prebake.mjs', 'website/src/repl/prebake.ts']) {
    scanRegisteredNames(readFileSync(join(ROOT, file), 'utf8')).forEach((name) => known.add(name));
  }
  // How an operator aligns its patterns, as in `.add.out(...)` (packages/core/pattern.mjs, `composers`).
  ['in', 'out', 'mix', 'squeeze', 'squeezeout', 'reset', 'restart', 'poly'].forEach((name) => known.add(name));
  // What a pattern's code may call on plain JavaScript values.
  const builtIns = [
    Array,
    String,
    Number,
    Object,
    Function,
    Promise,
    Map,
    Set,
    Date,
    RegExp,
    Math,
    JSON,
    console,
    Reflect,
  ];
  for (const value of builtIns) {
    Object.getOwnPropertyNames(value).forEach((name) => known.add(name));
    if (value.prototype) Object.getOwnPropertyNames(value.prototype).forEach((name) => known.add(name));
  }
  // The REPL's own scope (packages/core/repl.mjs), and the noises and other things the page provides.
  ['all', 'each', 'hush', 'setCps', 'setcps', 'setCpm', 'setcpm', 'setCPS', 'setCPM'].forEach((name) =>
    known.add(name),
  );
  const globals = [
    'Array',
    'String',
    'Number',
    'Object',
    'Boolean',
    'Function',
    'Promise',
    'Map',
    'Set',
    'Date',
    'RegExp',
    'Symbol',
    'BigInt',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'fetch',
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
    'requestAnimationFrame',
    'import',
    'require',
    'alert',
    'encodeURIComponent',
    'decodeURIComponent',
    'Error',
    'Float32Array',
    'Uint8Array',
  ];
  globals.forEach((name) => known.add(name));
  return [...known].filter((name) => !name.startsWith('_')).sort();
}

const mapKeys = (file) => Object.keys(JSON.parse(read(`website/public/${file}`))).filter((key) => !key.startsWith('_'));

function buildSounds() {
  const prebake = read('website/src/repl/prebake.ts');
  // samples({ name: [...], ... }): the top-level keys of the lists written out in prebake.ts.
  const inline = [...prebake.matchAll(/^ {8}([a-zA-Z_][\w]*): (?:\[|\{)/gm)].map((match) => match[1]);
  const synth = read('packages/superdough/synth.mjs');
  const waveforms = [...synth.matchAll(/const waveforms = \[([^\]]*)\]/g)].flatMap(([, list]) =>
    [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  );
  const named = [...synth.matchAll(/registerSound\(\s*'([^']+)'/g)].map((match) => match[1]);
  const noises = [...read('packages/superdough/helpers.mjs').matchAll(/noises = \[([^\]]*)\]/g)].flatMap(([, list]) =>
    [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  );
  const zzfx = [...read('packages/superdough/zzfx.mjs').matchAll(/\[('zzfx'[^\]]*)\]/g)].flatMap(([, list]) =>
    [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]),
  );
  const gm = [...read('packages/soundfonts/gm.mjs').matchAll(/^ {2}(gm_[\w]+):/gm)].map((match) => match[1]);
  const unique = (names) => [...new Set(names)].sort();
  const drumMachines = mapKeys('tidal-drum-machines.json');
  return {
    source: 'website/public sample maps, website/src/repl/prebake.ts, packages/soundfonts/gm.mjs, packages/superdough',
    synths: unique([...waveforms, ...named, ...noises, ...zzfx]),
    samples: unique([
      ...inline,
      ...mapKeys('piano.json'),
      ...mapKeys('vcsl.json'),
      ...mapKeys('uzu-drumkit.json'),
      ...mapKeys('mridangam.json'),
      ...mapKeys('uzu-wavetables.json'),
    ]),
    drumMachines: unique(drumMachines),
    banks: unique(drumMachines.map((name) => name.split('_')[0])),
    soundfonts: unique(gm),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mkdirSync(OUT, { recursive: true });
  const functions = buildFunctions(JSON.parse(read('doc.json')).docs);
  const write = (name, value) => {
    const text = JSON.stringify(value);
    writeFileSync(join(OUT, name), `${text}\n`);
    console.log(`${name}: ${(text.length / 1024).toFixed(0)} KB`);
  };
  write('functions.json', functions);
  write('known.json', buildKnown(functions));
  write('sounds.json', buildSounds());
}
