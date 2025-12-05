import jsdoc from '../../doc.json';
import { autocompletion } from '@codemirror/autocomplete';
import { h } from './html';
import { Scale } from '@tonaljs/tonal';
import { soundMap } from 'superdough';
import { complex } from '@strudel/tonal';

const escapeHtml = (str) => {
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
};

const stripHtml = (html) => {
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

// Hydra functions with descriptions
// These show tooltips for both standalone calls and method chains
const hydraFunctionDocs = {
  // Sources
  osc: 'Hydra: Oscillator source - generates wave patterns',
  solid: 'Hydra: Solid color source',
  gradient: 'Hydra: Gradient source',
  noise: 'Hydra: Noise source - generates random patterns',
  voronoi: 'Hydra: Voronoi pattern source',
  shape: 'Hydra: Geometric shape source',
  src: 'Hydra: Use external source or output',
  
  // Transforms
  rotate: 'Hydra: Rotate the visual',
  scale: 'Hydra: Scale the visual',
  pixelate: 'Hydra: Pixelate effect',
  repeat: 'Hydra: Repeat/tile the visual',
  repeatX: 'Hydra: Repeat horizontally',
  repeatY: 'Hydra: Repeat vertically',
  kaleid: 'Hydra: Kaleidoscope effect',
  scroll: 'Hydra: Scroll the visual',
  scrollX: 'Hydra: Scroll horizontally',
  scrollY: 'Hydra: Scroll vertically',
  
  // Color
  invert: 'Hydra: Invert colors',
  contrast: 'Hydra: Adjust contrast',
  brightness: 'Hydra: Adjust brightness',
  luma: 'Hydra: Luminance threshold',
  thresh: 'Hydra: Threshold effect',
  color: 'Hydra: Colorize with RGB values',
  saturate: 'Hydra: Adjust saturation',
  hue: 'Hydra: Adjust hue',
  colorama: 'Hydra: Color shift effect',
  posterize: 'Hydra: Posterize colors',
  shift: 'Hydra: Shift colors',
  
  // Modulation
  modulate: 'Hydra: Modulate with another source',
  modulateRotate: 'Hydra: Modulate rotation',
  modulateScale: 'Hydra: Modulate scale',
  modulatePixelate: 'Hydra: Modulate pixelation',
  modulateRepeat: 'Hydra: Modulate repetition',
  modulateRepeatX: 'Hydra: Modulate horizontal repetition',
  modulateRepeatY: 'Hydra: Modulate vertical repetition',
  modulateKaleid: 'Hydra: Modulate kaleidoscope',
  modulateScrollX: 'Hydra: Modulate horizontal scroll',
  modulateScrollY: 'Hydra: Modulate vertical scroll',
  
  // Blending
  add: 'Hydra: Add/blend two sources',
  sub: 'Hydra: Subtract one source from another',
  mult: 'Hydra: Multiply two sources',
  blend: 'Hydra: Blend two sources',
  diff: 'Hydra: Difference between sources',
  layer: 'Hydra: Layer sources',
  mask: 'Hydra: Mask with another source',
  
  // Output
  out: 'Hydra: Output to buffer',
  render: 'Hydra: Render output',
  speed: 'Hydra: Animation speed',
  bpm: 'Hydra: Beats per minute',
};

const hydraFunctions = Object.keys(hydraFunctionDocs).map(name => ({
  label: name,
  type: 'function',
  detail: ` ${hydraFunctionDocs[name]}`,
}));

const hydraCompletions = hydraFunctions;

// Export for use in tooltip
export { hydraFunctionDocs };

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
