import jsdoc from '../../doc.json';
import { autocompletion } from '@codemirror/autocomplete';
import { h } from './html';
import { Scale } from '@tonaljs/tonal';
import { soundMap } from 'superdough';
import { complex } from '@strudel/tonal';

const escapeHtml = (str) => {
  if (typeof document === 'undefined') {
    // Server-side: manual HTML escaping
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
};

const stripHtml = (html) => {
  if (typeof document === 'undefined') {
    // Server-side: simple regex-based HTML stripping
    return html.replace(/<[^>]*>/g, '');
  }
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

const getDocLabel = (doc) => doc.name || doc.longname;

const buildParamsList = (params) =>
  params?.length
    ? `
    <div class="autocomplete-info-params-section">
      <h4 class="autocomplete-info-section-title">Parameters</h4>
      <ul class="autocomplete-info-params-list">
        ${params
          .map(
            ({ name, type, description }) => `
          <li class="autocomplete-info-param-item">
            <span class="autocomplete-info-param-name">${name}</span>
            <span class="autocomplete-info-param-type">${type.names?.join(' | ')}</span>
            ${description ? `<div class="autocomplete-info-param-desc">${stripHtml(description)}</div>` : ''}
          </li>
        `,
          )
          .join('')}
      </ul>
    </div>
  `
    : '';

const buildExamples = (examples) =>
  examples?.length
    ? `
    <div class="autocomplete-info-examples-section">
      <h4 class="autocomplete-info-section-title">Examples</h4>
      ${examples
        .map(
          (example) => `
        <pre class="autocomplete-info-example-code">${escapeHtml(example)}</pre>
      `,
        )
        .join('')}
    </div>
  `
    : '';

export const Autocomplete = (doc) =>
  h`
  <div class="autocomplete-info-container">
    <div class="autocomplete-info-tooltip">
      <h3 class="autocomplete-info-function-name">${getDocLabel(doc)}</h3>
      ${doc.synonyms_text ? `<div class="autocomplete-info-function-synonyms">Synonyms: ${doc.synonyms_text}</div>` : ''}
      ${doc.description ? `<div class="autocomplete-info-function-description">${doc.description}</div>` : ''}
      ${buildParamsList(doc.params)}
      ${buildExamples(doc.examples)}
    </div>
  </div>
`[0];

const isValidDoc = (doc) => {
  const label = getDocLabel(doc);
  return label && !label.startsWith('_') && !['package'].includes(doc.kind);
};

const hasExcludedTags = (doc) =>
  ['superdirtOnly', 'noAutocomplete'].some((tag) => doc.tags?.find((t) => t.originalTitle === tag));

export function bankCompletions() {
  const soundDict = soundMap.get();
  const banks = new Set();
  for (const key of Object.keys(soundDict)) {
    const [bank, suffix] = key.split('_');
    if (suffix && bank) banks.add(bank);
  }
  return Array.from(banks)
    .sort()
    .map((name) => ({ label: name, type: 'bank' }));
}

// Attempt to get all scale names from Tonal
let scaleCompletions = [];
try {
  scaleCompletions = (Scale.names ? Scale.names() : []).map((name) => ({ label: name, type: 'scale' }));
} catch (e) {
  console.warn('[autocomplete] Could not load scale names from Tonal:', e);
}

// Valid mode values for voicing
const modeCompletions = [
  { label: 'below', type: 'mode' },
  { label: 'above', type: 'mode' },
  { label: 'duck', type: 'mode' },
  { label: 'root', type: 'mode' },
];

// Valid chord symbols from ireal dictionary plus empty string for major triads
const chordSymbols = ['', ...Object.keys(complex)].sort();
const chordSymbolCompletions = chordSymbols.map((symbol) => {
  if (symbol === '') {
    return {
      label: 'major',
      apply: '',
      type: 'chord-symbol',
    };
  }
  return {
    label: symbol,
    apply: symbol,
    type: 'chord-symbol',
  };
});

// Hydra functions with structured documentation (like JSDoc format)
export const hydraFunctionDocs = {
  // Sources
  osc: 'Oscillator source - generates wave patterns. Parameters: frequency (default 60), sync (default 0.1), offset (default 0). Example: osc(10, 0.1, 0)',
  solid: 'Solid color source. Parameters: r, g, b, a (all 0-1). Example: solid(1, 0, 0, 1) for red',
  gradient: 'Gradient source. Parameters: speed (default 0). Example: gradient(1)',
  noise: 'Noise source - generates random patterns. Parameters: scale (default 10), offset (default 0.1). Example: noise(3, 0.1)',
  voronoi: 'Voronoi pattern source. Parameters: scale (default 5), speed (default 0.3), blending (default 0.3). Example: voronoi(5, 0.3, 0.3)',
  shape: 'Geometric shape source. Parameters: sides (default 3), radius (default 0.3), smoothing (default 0.01). Example: shape(4, 0.5, 0.01) for square',
  src: 'Use external source or output buffer. Parameters: source (o0, o1, o2, o3, or s0). Example: src(o0) for feedback',
  
  // Transforms
  rotate: 'Rotate the visual. Parameters: angle (radians), speed (default 0). Example: rotate(0.5, 0.1)',
  scale: 'Scale the visual. Parameters: amount (default 1.5), xMult (default 1), yMult (default 1). Example: scale(2, 1, 1)',
  pixelate: 'Pixelate effect. Parameters: x (default 20), y (default 20). Example: pixelate(10, 10)',
  repeat: 'Repeat/tile the visual. Parameters: repeatX (default 3), repeatY (default 3), offsetX (default 0), offsetY (default 0). Example: repeat(4, 4)',
  repeatX: 'Repeat horizontally. Parameters: reps (default 3), offset (default 0). Example: repeatX(4, 0)',
  repeatY: 'Repeat vertically. Parameters: reps (default 3), offset (default 0). Example: repeatY(4, 0)',
  kaleid: 'Kaleidoscope effect. Parameters: nSides (default 4). Example: kaleid(6) for 6-sided kaleidoscope',
  scroll: 'Scroll the visual. Parameters: scrollX (default 0.5), scrollY (default 0.5), speedX (default 0), speedY (default 0). Example: scroll(0.5, 0.5)',
  scrollX: 'Scroll horizontally. Parameters: scrollX (default 0.5), speed (default 0). Example: scrollX(0.5, 0.1)',
  scrollY: 'Scroll vertically. Parameters: scrollY (default 0.5), speed (default 0). Example: scrollY(0.5, 0.1)',
  
  // Color
  invert: 'Invert colors. Parameters: amount (default 1). Example: invert(1)',
  contrast: 'Adjust contrast. Parameters: amount (default 1.6). Example: contrast(2)',
  brightness: 'Adjust brightness. Parameters: amount (default 0.4). Example: brightness(0.5)',
  luma: 'Luminance threshold - creates black/white based on brightness. Parameters: threshold (default 0.5), tolerance (default 0.1). Example: luma(0.5, 0.1)',
  thresh: 'Threshold effect. Parameters: threshold (default 0.5), tolerance (default 0.04). Example: thresh(0.5, 0.1)',
  color: 'Colorize with RGB values. Parameters: r (default 1), g (default 1), b (default 1), a (default 1). Example: color(1, 0.5, 0.8)',
  saturate: 'Adjust saturation. Parameters: amount (default 2). Example: saturate(1.5)',
  hue: 'Adjust hue. Parameters: amount (default 0.4). Example: hue(0.5)',
  colorama: 'Color shift effect - cycles through colors. Parameters: amount (default 0.005). Example: colorama(0.01)',
  posterize: 'Posterize colors - reduce color palette. Parameters: bins (default 3), gamma (default 0.6). Example: posterize(5, 0.6)',
  shift: 'Shift colors in RGB space. Parameters: r (default 0.5), g (default 0.5), b (default 0.5), a (default 0.5). Example: shift(0.1, 0.2, 0.3)',
  
  // Modulation
  modulate: 'Modulate position with another source. Parameters: source, amount (default 0.1). Example: modulate(noise(3), 0.1)',
  modulateRotate: 'Modulate rotation with another source. Parameters: source, multiple (default 1), offset (default 0). Example: modulateRotate(osc(1), 0.5)',
  modulateScale: 'Modulate scale with another source. Parameters: source, multiple (default 1), offset (default 1). Example: modulateScale(noise(3), 0.5)',
  modulatePixelate: 'Modulate pixelation with another source. Parameters: source, multiple (default 10), offset (default 3). Example: modulatePixelate(noise(3), 10)',
  modulateRepeat: 'Modulate repetition with another source. Parameters: source, repeatX (default 3), repeatY (default 3), offsetX (default 0.5), offsetY (default 0.5). Example: modulateRepeat(osc(1), 3, 3)',
  modulateRepeatX: 'Modulate horizontal repetition. Parameters: source, reps (default 3), offset (default 0.5). Example: modulateRepeatX(osc(1), 3)',
  modulateRepeatY: 'Modulate vertical repetition. Parameters: source, reps (default 3), offset (default 0.5). Example: modulateRepeatY(osc(1), 3)',
  modulateKaleid: 'Modulate kaleidoscope with another source. Parameters: source, nSides (default 4). Example: modulateKaleid(osc(1), 4)',
  modulateScrollX: 'Modulate horizontal scroll. Parameters: source, scrollX (default 0.5), speed (default 0). Example: modulateScrollX(osc(1), 0.5)',
  modulateScrollY: 'Modulate vertical scroll. Parameters: source, scrollY (default 0.5), speed (default 0). Example: modulateScrollY(osc(1), 0.5)',
  
  // Blending
  add: 'Add/blend two sources together. Parameters: source, amount (default 0.5). Example: add(osc(10), 0.5)',
  sub: 'Subtract one source from another. Parameters: source, amount (default 1). Example: sub(osc(10), 0.5)',
  mult: 'Multiply two sources. Parameters: source, amount (default 1). Example: mult(osc(10), 0.5)',
  blend: 'Blend two sources. Parameters: source, amount (default 0.5). Example: blend(noise(3), 0.5)',
  diff: 'Difference between sources - creates interesting contrast effects. Parameters: source. Example: diff(osc(10))',
  layer: 'Layer sources on top of each other. Parameters: source. Example: layer(shape(4))',
  mask: 'Mask with another source - uses brightness as alpha. Parameters: source, reps (default 3), offset (default 0.5). Example: mask(shape(4))',
  
  // Output
  out: 'Output to buffer. Parameters: buffer (o0, o1, o2, o3). Example: out(o0) or just out()',
  render: 'Render specific output buffer to screen. Parameters: buffer (o0, o1, o2, o3). Example: render(o0)',
  speed: 'Animation speed multiplier. Parameters: speed (default 1). Example: speed(0.5) for half speed',
  bpm: 'Set beats per minute for time-based animations. Parameters: bpm (default 30). Example: bpm(120)',
  
  // Hydra-specific
  initHydra: 'Initialize Hydra video synth. Call with await at the top of your code. Options: {detectAudio: true} for audio reactivity, {feedStrudel: 1} to process Strudel visuals. Example: await initHydra({detectAudio: true})',
  H: 'Convert Strudel pattern to Hydra value. Use to drive Hydra parameters with patterns. Example: osc(H("10 20 30"), 0.1, 0)',
};

// Parse Hydra documentation string into structured format
export const parseHydraDoc = (name, docString) => {
  const parts = docString.split('. ');
  const description = parts[0] + '.';
  
  // Extract parameters
  const paramsMatch = docString.match(/Parameters?: ([^.]+)/);
  const params = [];
  if (paramsMatch) {
    const paramsStr = paramsMatch[1];
    const paramParts = paramsStr.split(', ');
    paramParts.forEach(part => {
      const match = part.match(/(\w+)\s*\(default\s+([^)]+)\)/);
      if (match) {
        params.push({
          name: match[1],
          type: 'number',
          default: match[2],
          description: `${match[1]} parameter`
        });
      }
    });
  }
  
  // Extract example
  const exampleMatch = docString.match(/Example: (.+)$/);
  const examples = exampleMatch ? [exampleMatch[1]] : [];
  
  return {
    name,
    description,
    params,
    examples
  };
};

const hydraFunctions = Object.keys(hydraFunctionDocs).map(name => ({
  label: name,
  type: 'function',
  detail: ` ${hydraFunctionDocs[name].split('.')[0]}...`, // Show first sentence only
}));

const hydraCompletions = hydraFunctions;

// Math object methods for global autocomplete
const mathCompletions = [
  'abs', 'ceil', 'floor', 'round', 'max', 'min', 'pow', 'sqrt', 'random',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'log10',
  'log2', 'sign', 'trunc', 'cbrt', 'hypot', 'PI', 'E'
].map(name => ({
  label: `Math.${name}`,
  type: 'property',
  info: `Math.${name}`,
}));

export const getSynonymDoc = (doc, synonym) => {
  const synonyms = doc.synonyms || [];
  const docLabel = getDocLabel(doc);
  // Swap `doc.name` in for `s` in the list of synonyms
  const synonymsWithDoc = [docLabel, ...synonyms].filter((x) => x && x !== synonym);
  return {
    ...doc,
    name: synonym,
    longname: synonym,
    synonyms: synonymsWithDoc,
    synonyms_text: synonymsWithDoc.join(', '),
  };
};

const jsdocCompletions = (() => {
  const seen = new Set(); // avoid repetition
  const completions = [];
  for (const doc of jsdoc.docs) {
    if (!isValidDoc(doc) || hasExcludedTags(doc)) continue;
    const docLabel = getDocLabel(doc);
    // Remove duplicates
    const synonyms = doc.synonyms || [];
    let labels = [docLabel, ...synonyms];
    for (const label of labels) {
      // https://codemirror.net/docs/ref/#autocomplete.Completion
      if (label && !seen.has(label)) {
        seen.add(label);
        const synonymDoc = getSynonymDoc(doc, label);
        const cleanDesc = synonymDoc.description ? stripHtml(synonymDoc.description) : '';
        completions.push({
          label,
          detail: cleanDesc ? ` ${cleanDesc.slice(0, 50)}${cleanDesc.length > 50 ? '...' : ''}` : '',
          type: 'function', // https://codemirror.net/docs/ref/#autocomplete.Completion.type
        });
      }
    }
  }
  // Add Hydra functions to completions
  for (const hydraFunc of hydraCompletions) {
    if (!seen.has(hydraFunc.label)) {
      seen.add(hydraFunc.label);
      completions.push(hydraFunc);
    }
  }
  // Add Math methods to completions
  for (const mathFunc of mathCompletions) {
    if (!seen.has(mathFunc.label)) {
      seen.add(mathFunc.label);
      completions.push(mathFunc);
    }
  }
  return completions;
})();

// --- Handler functions for each context ---
const pitchNames = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'E#',
  'Fb',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
  'B#',
  'Cb',
];

// Cached regex patterns for scaleHandler
const SCALE_NO_QUOTES_REGEX = /scale\(\s*$/;
const SCALE_AFTER_COLON_REGEX = /scale\(\s*['"][^'"]*:[^'"]*$/;
const SCALE_PRE_COLON_REGEX = /scale\(\s*['"][^'"]*$/;
const SCALE_PITCH_MATCH_REGEX = /([A-Ga-g][#b]*)?$/;
const SCALE_SPACES_TO_COLON_REGEX = /\s+/g;

function scaleHandler(context) {
  // First check for scale context without quotes - block with empty completions
  let scaleNoQuotesContext = context.matchBefore(SCALE_NO_QUOTES_REGEX);
  if (scaleNoQuotesContext) {
    return {
      from: scaleNoQuotesContext.to,
      options: [],
    };
  }

  // Check for after-colon context first (more specific)
  let scaleAfterColonContext = context.matchBefore(SCALE_AFTER_COLON_REGEX);
  if (scaleAfterColonContext) {
    const text = scaleAfterColonContext.text;
    const colonIdx = text.lastIndexOf(':');
    if (colonIdx !== -1) {
      const fragment = text.slice(colonIdx + 1);
      const filteredScales = scaleCompletions.filter((s) => s.label.startsWith(fragment));
      const options = filteredScales.map((s) => ({
        ...s,
        apply: s.label.replace(SCALE_SPACES_TO_COLON_REGEX, ':'),
      }));
      const from = scaleAfterColonContext.from + colonIdx + 1;
      return {
        from,
        options,
      };
    }
  }

  // Then check for pre-colon context
  let scalePreColonContext = context.matchBefore(SCALE_PRE_COLON_REGEX);
  if (scalePreColonContext) {
    if (!scalePreColonContext.text.includes(':')) {
      if (context.explicit) {
        const text = scalePreColonContext.text;
        const match = text.match(SCALE_PITCH_MATCH_REGEX);
        const fragment = match ? match[0] : '';
        const filtered = pitchNames.filter((p) => p.toLowerCase().startsWith(fragment.toLowerCase()));
        const from = scalePreColonContext.to - fragment.length;
        const options = filtered.map((p) => ({ label: p, type: 'pitch' }));
        return { from, options };
      } else {
        return { from: scalePreColonContext.to, options: [] };
      }
    }
  }
  return null;
}

// Cached regex patterns for soundHandler
const SOUND_NO_QUOTES_REGEX = /(s|sound)\(\s*$/;
const SOUND_WITH_QUOTES_REGEX = /(s|sound)\(\s*['"][^'"]*$/;
const SOUND_FRAGMENT_MATCH_REGEX = /(?:[\s[{(<])([\w]*)$/;

function soundHandler(context) {
  // First check for sound context without quotes - block with empty completions
  let soundNoQuotesContext = context.matchBefore(SOUND_NO_QUOTES_REGEX);
  if (soundNoQuotesContext) {
    return {
      from: soundNoQuotesContext.to,
      options: [],
    };
  }

  // Then check for sound context with quotes - provide completions
  let soundContext = context.matchBefore(SOUND_WITH_QUOTES_REGEX);
  if (!soundContext) return null;

  const text = soundContext.text;
  const quoteIdx = Math.max(text.lastIndexOf('"'), text.lastIndexOf("'"));
  if (quoteIdx === -1) return null;
  const inside = text.slice(quoteIdx + 1);
  const fragMatch = inside.match(SOUND_FRAGMENT_MATCH_REGEX);
  const fragment = fragMatch ? fragMatch[1] : inside;
  const soundNames = Object.keys(soundMap.get()).sort();
  const filteredSounds = soundNames.filter((name) => name.includes(fragment));
  let options = filteredSounds.map((name) => ({ label: name, type: 'sound' }));
  const from = soundContext.to - fragment.length;
  return {
    from,
    options,
  };
}

// Cached regex patterns for bankHandler
const BANK_NO_QUOTES_REGEX = /bank\(\s*$/;
const BANK_WITH_QUOTES_REGEX = /bank\(\s*['"][^'"]*$/;

function bankHandler(context) {
  // First check for bank context without quotes - block with empty completions
  let bankNoQuotesContext = context.matchBefore(BANK_NO_QUOTES_REGEX);
  if (bankNoQuotesContext) {
    return {
      from: bankNoQuotesContext.to,
      options: [],
    };
  }

  // Then check for bank context with quotes - provide completions
  let bankMatch = context.matchBefore(BANK_WITH_QUOTES_REGEX);
  if (!bankMatch) return null;

  const text = bankMatch.text;
  const quoteIdx = Math.max(text.lastIndexOf('"'), text.lastIndexOf("'"));
  if (quoteIdx === -1) return null;
  const inside = text.slice(quoteIdx + 1);
  const fragment = inside;
  let banks = bankCompletions();
  const filteredBanks = banks.filter((b) => b.label.startsWith(fragment));
  const from = bankMatch.to - fragment.length;
  return {
    from,
    options: filteredBanks,
  };
}

// Cached regex patterns for modeHandler
const MODE_NO_QUOTES_REGEX = /mode\(\s*$/;
const MODE_AFTER_COLON_REGEX = /mode\(\s*['"][^'"]*:[^'"]*$/;
const MODE_PRE_COLON_REGEX = /mode\(\s*['"][^'"]*$/;
const MODE_FRAGMENT_MATCH_REGEX = /(?:[\s[{(<])([\w:]*)$/;

function modeHandler(context) {
  // First check for mode context without quotes - block with empty completions
  let modeNoQuotesContext = context.matchBefore(MODE_NO_QUOTES_REGEX);
  if (modeNoQuotesContext) {
    return {
      from: modeNoQuotesContext.to,
      options: [],
    };
  }

  // Check for after-colon context first (more specific)
  let modeAfterColonContext = context.matchBefore(MODE_AFTER_COLON_REGEX);
  if (modeAfterColonContext) {
    const text = modeAfterColonContext.text;
    const colonIdx = text.lastIndexOf(':');
    if (colonIdx !== -1) {
      const fragment = text.slice(colonIdx + 1);
      // For anchor after colon, we can suggest pitch names
      const filtered = pitchNames.filter((p) => p.toLowerCase().startsWith(fragment.toLowerCase()));
      const options = filtered.map((p) => ({ label: p, type: 'pitch' }));
      const from = modeAfterColonContext.from + colonIdx + 1;
      return {
        from,
        options,
      };
    }
  }

  // Then check for pre-colon context
  let modeContext = context.matchBefore(MODE_PRE_COLON_REGEX);
  if (!modeContext) return null;

  const text = modeContext.text;
  const quoteIdx = Math.max(text.lastIndexOf('"'), text.lastIndexOf("'"));
  if (quoteIdx === -1) return null;
  const inside = text.slice(quoteIdx + 1);
  const fragMatch = inside.match(MODE_FRAGMENT_MATCH_REGEX);
  const fragment = fragMatch ? fragMatch[1] : inside;
  const filteredModes = modeCompletions.filter((m) => m.label.startsWith(fragment));
  const from = modeContext.to - fragment.length;
  return {
    from,
    options: filteredModes,
  };
}

// Cached regex patterns for chordHandler
const CHORD_NO_QUOTES_REGEX = /chord\(\s*$/;
const CHORD_WITH_QUOTES_REGEX = /chord\(\s*['"][^'"]*$/;
const CHORD_FRAGMENT_MATCH_REGEX = /(?:[\s[{(<])([\w#b+^:-]*)$/;

function chordHandler(context) {
  // First check for chord context without quotes - block with empty completions
  let chordNoQuotesContext = context.matchBefore(CHORD_NO_QUOTES_REGEX);
  if (chordNoQuotesContext) {
    return {
      from: chordNoQuotesContext.to,
      options: [],
    };
  }

  // Then check for chord context with quotes - provide completions
  let chordContext = context.matchBefore(CHORD_WITH_QUOTES_REGEX);
  if (!chordContext) return null;

  const text = chordContext.text;
  const quoteIdx = Math.max(text.lastIndexOf('"'), text.lastIndexOf("'"));
  if (quoteIdx === -1) return null;
  const inside = text.slice(quoteIdx + 1);

  // Use same fragment matching as sound/mode for expressions like "<G Am>"
  const fragMatch = inside.match(CHORD_FRAGMENT_MATCH_REGEX);
  const fragment = fragMatch ? fragMatch[1] : inside;

  // Check if fragment contains any pitch name at start (for root + symbol)
  let rootMatch = null;
  let symbolFragment = fragment;
  for (const pitch of pitchNames) {
    if (fragment.toLowerCase().startsWith(pitch.toLowerCase())) {
      rootMatch = pitch;
      symbolFragment = fragment.slice(pitch.length);
      break;
    }
  }

  if (rootMatch) {
    // We have a root, now complete chord symbols
    const filteredSymbols = chordSymbolCompletions.filter((s) =>
      s.label.toLowerCase().startsWith(symbolFragment.toLowerCase()),
    );

    // Create completions that replace the entire chord, not just the symbol part
    const options = filteredSymbols;

    const from = chordContext.to - symbolFragment.length;
    return { from, options };
  } else {
    // No root yet, complete with pitch names
    const filteredPitches = pitchNames.filter((p) => p.toLowerCase().startsWith(fragment.toLowerCase()));
    const options = filteredPitches.map((p) => ({ label: p, type: 'pitch' }));
    const from = chordContext.to - fragment.length;
    return { from, options };
  }
}

// Standard JavaScript methods for common types
const jsArrayMethods = [
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'join',
  'reverse', 'sort', 'includes', 'indexOf', 'lastIndexOf', 'flat', 'flatMap',
  'fill', 'copyWithin', 'entries', 'keys', 'values', 'at', 'length'
].map(name => ({ label: name, type: 'method', info: `Array method: ${name}` }));

const jsStringMethods = [
  'charAt', 'charCodeAt', 'concat', 'includes', 'indexOf', 'lastIndexOf',
  'match', 'matchAll', 'replace', 'replaceAll', 'search', 'slice', 'split',
  'substring', 'toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd',
  'padStart', 'padEnd', 'repeat', 'startsWith', 'endsWith', 'length'
].map(name => ({ label: name, type: 'method', info: `String method: ${name}` }));

const jsNumberMethods = [
  'toFixed', 'toExponential', 'toPrecision', 'toString', 'valueOf'
].map(name => ({ label: name, type: 'method', info: `Number method: ${name}` }));

const jsObjectMethods = [
  'hasOwnProperty', 'toString', 'valueOf', 'constructor'
].map(name => ({ label: name, type: 'method', info: `Object method: ${name}` }));

const allJsMethods = [...jsArrayMethods, ...jsStringMethods, ...jsNumberMethods, ...jsObjectMethods];

// Cached regex patterns for methodHandler
const METHOD_AFTER_DOT_REGEX = /\.\w*$/;
const METHOD_WORD_REGEX = /\w*$/;

function methodHandler(context) {
  // Check if we're after a dot (method call context)
  const afterDot = context.matchBefore(METHOD_AFTER_DOT_REGEX);
  if (afterDot) {
    const word = afterDot.text.slice(1); // Remove the dot
    // Filter to only show pattern methods (functions that are typically chained)
    const patternMethods = jsdocCompletions.filter(completion => {
      const doc = jsdoc.docs.find(d => getDocLabel(d) === completion.label);
      // Include if it's a common pattern method or has @memberof Pattern
      return doc && (
        doc.memberof === 'Pattern' ||
        doc.tags?.some(t => t.originalTitle === 'patternMethod') ||
        // Common pattern methods
        ['gain', 'speed', 'note', 'sound', 's', 'n', 'slow', 'fast', 'rev', 'jux', 
         'every', 'off', 'layer', 'stack', 'cat', 'seq', 'add', 'sub', 'mul', 'div',
         'lpf', 'hpf', 'vowel', 'room', 'delay', 'delaytime', 'delayfeedback',
         'cutoff', 'resonance', 'crush', 'coarse', 'shape', 'pan', 'orbit',
         'sometimes', 'often', 'rarely', 'almostNever', 'almostAlways', 'never',
         'degradeBy', 'ply', 'echo', 'echoWith', 'stut', 'chop', 'slice', 'splice',
         'loopAt', 'fit', 'chunk', 'unchunk', 'inside', 'outside', 'when', 'mask',
         'struct', 'euclidLegato', 'euclid', 'press', 'pressBy', 'range', 'rangex',
         'scale', 'scaleWithOctave', 'chord', 'voicing', 'mode', 'transpose',
         'superimpose', 'arp', 'arpeggiate', 'striate', 'scramble', 'shuffle',
         'rot', 'iter', 'palindrome', 'swing', 'swingBy', 'hurry', 'compress',
         'zoom', 'fastGap', 'densityGap', 'sparsity', 'linger', 'segment',
         'timecat', 'timeCat', 'append', 'firstOf', 'lastOf', 'repeatCycles',
         'fastcat', 'slowcat', 'fastCat', 'slowCat', 'overlay', 'sine', 'saw',
         'square', 'tri', 'cosine', 'rand', 'irand', 'perlin', 'sine2', 'saw2',
         'square2', 'tri2', 'cosine2', 'smooth', 'segment', 'fit', 'quantize'
        ].includes(completion.label)
      );
    });
    
    // Combine pattern methods with standard JavaScript methods
    const allMethods = [...patternMethods, ...allJsMethods];
    
    return {
      from: afterDot.from + 1, // Start after the dot
      options: allMethods.filter(m => m.label.startsWith(word)),
    };
  }
  return null;
}

// Cached regex patterns for fallbackHandler
const FALLBACK_WORD_REGEX = /\w*/;

function fallbackHandler(context) {
  const word = context.matchBefore(FALLBACK_WORD_REGEX);
  if (word && word.from === word.to && !context.explicit) return null;
  if (word) {
    return {
      from: word.from,
      options: jsdocCompletions,
    };
  }
  return null;
}

const handlers = [
  soundHandler,
  bankHandler,
  chordHandler,
  scaleHandler,
  modeHandler,
  methodHandler, // Check for method calls after dot
  // this handler *must* be last
  fallbackHandler,
];

export const strudelAutocomplete = (context) => {
  console.log('[autocomplete] triggered at pos:', context.pos, 'explicit:', context.explicit);
  for (const handler of handlers) {
    const result = handler(context);
    if (result) {
      console.log('[autocomplete] matched handler, options:', result.options?.length || 0);
      return result;
    }
  }
  console.log('[autocomplete] no match');
  return null;
};

export const isAutoCompletionEnabled = (enabled) => {
  console.log('[autocomplete] isAutoCompletionEnabled called, enabled:', enabled);
  if (enabled) {
    console.log('[autocomplete] registering autocomplete extension');
    return [autocompletion({ 
      override: [strudelAutocomplete], 
      closeOnBlur: false,
      activateOnTyping: true,
      maxRenderedOptions: 100,
    })];
  }
  console.log('[autocomplete] autocomplete disabled');
  return [];
};
