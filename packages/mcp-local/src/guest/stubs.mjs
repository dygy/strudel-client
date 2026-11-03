// What the browser's scope has beyond core, mini and tonal, and that can't change which events a
// pattern produces. All of it is reported as skipped, so an assistant knows it did nothing here.

/** Loaders: they register sounds or start engines, which a run without audio doesn't need. */
const LOADERS = [
  'aliasBank',
  'initAudio',
  'initAudioOnFirstClick',
  'initHydra',
  'loadCSound',
  'loadCsound',
  'loadOrc',
  'loadSoundfont',
  'loadcsound',
  'registerSoundfonts',
  'registerSynthSounds',
  'samples',
  'soundAlias',
];

/** Pattern methods that only draw, or send the same events to another output. */
const PASS_THROUGH_METHODS = [
  'animate',
  'csound',
  'csoundm',
  'dough',
  'draw',
  'fscope',
  'markcss',
  'midi',
  'mqtt',
  'onPaint',
  'osc',
  'pianoroll',
  'pitchwheel',
  'punchcard',
  'scope',
  'serial',
  'soundfont',
  'spectrum',
  'spiral',
  'supradough',
  'tscope',
  'wordfall',
];

/** The inline variants that @strudel/codemirror registers as widgets. */
const INLINE_WIDGETS = ['_pianoroll', '_pitchwheel', '_punchcard', '_scope', '_spectrum', '_spiral'];

/**
 * Adds the pass-through methods to Pattern.prototype, and builds the functions for the global scope.
 * @param {object} core the @strudel/core module
 * @param {Set<string>} skipped collects the names that were used
 * @returns {object} the functions to add to the scope
 */
export function createStubs({ Pattern, isPattern, ref }, skipped) {
  const scope = {};
  for (const name of LOADERS) {
    scope[name] = async () => {
      skipped.add(name);
    };
  }
  for (const name of [...PASS_THROUGH_METHODS, ...INLINE_WIDGETS]) {
    if (name in Pattern.prototype) {
      continue;
    }
    const reportedName = name.replace(/^_/, '');
    Pattern.prototype[name] = function () {
      skipped.add(reportedName);
      return this;
    };
    // the function form, as in all(pianoroll) or pianoroll({ labels: 1 }, pattern)
    scope[name] = (...args) => {
      skipped.add(reportedName);
      const last = args[args.length - 1];
      return isPattern(last) ? last : (pattern) => pattern;
    };
  }
  // The transpiler rewrites slider(x) to sliderWithID(id, x), and so on. Same pattern as
  // @strudel/codemirror, holding the value from the code, as the browser does until someone drags it.
  scope.sliderWithID = (_id, value) => {
    skipped.add('slider');
    return ref(() => value);
  };
  scope.toggleWithID = (_id, value) => {
    skipped.add('toggle');
    return ref(() => value);
  };
  scope.radioWithID = (_id, value) => {
    skipped.add('radio');
    return ref(() => value);
  };
  return scope;
}
