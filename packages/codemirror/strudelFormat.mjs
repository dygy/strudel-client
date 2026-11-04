import { parse } from 'acorn';
import { literalsOf, protectTokens, withoutTrailingComments } from './protectTokens.mjs';
import { splitGluedAfterNumbers } from './splitGlued.mjs';

const STRUDEL_PATTERNS = [
  /\$:/, // Strudel pattern syntax
  /\bs\(/, // s() function
  /\.s\(/, // .s() method
  /\barrange\(/, // arrange() function
  /\bstack\(/, // stack() function
  /\.stack\(/, // .stack() method
  /\.sound\(/, // .sound() method
  /\.note\(/, // .note() method
  /\.scale\(/, // .scale() method
  /\.euclidRot\(/, // .euclidRot() method
  /\._pianoroll\(/, // ._pianoroll() method
  /setcps\(/, // setcps() function
  /samples\(/, // samples() function
  /initHydra\(/, // initHydra() function
  /\.gain\(/, // .gain() method
  /\.lpf\(/, // .lpf() method
  /\.room\(/, // .room() method
  /\.slow\(/, // .slow() method
  /\.fast\(/, // .fast() method
  /\.rev\(/, // .rev() method
  /\.sometimes\(/, // .sometimes() method
  /\.every\(/, // .every() method
  /\.bank\(/, // .bank() method
  /\.crush\(/, // .crush() method
  /\.distort\(/, // .distort() method
  /\.delay\(/, // .delay() method
  /\.sustain\(/, // .sustain() method
  /\.legato\(/, // .legato() method
  /\.clip\(/, // .clip() method
  /\.pan\(/, // .pan() method
  /\.speed\(/, // .speed() method
  /\.decay\(/, // .decay() method
  /\.add\(/, // .add() method
  /\.color\(/, // .color() method (Hydra)
  /\.rotate\(/, // .rotate() method (Hydra)
  /\.kaleid\(/, // .kaleid() method (Hydra)
  /\.modulate\(/, // .modulate() method (Hydra)
  /\.brightness\(/, // .brightness() method (Hydra)
  /\.blend\(/, // .blend() method (Hydra)
  /\.out\(/, // .out() method (Hydra)
  /shape\(/, // shape() function (Hydra)
  /osc\(/, // osc() function (Hydra)
  /src\(/, // src() function (Hydra)
  /sine\.range\(/, // sine.range() (Strudel)
  /perlin\.range\(/, // perlin.range() (Strudel)
  /<[^>]*>/, // Mini notation patterns like <0 1 2>
  /\[[^\]]*\]/, // Array-like patterns [c5 e5 g5]
  /@\d+/, // Duration patterns like @3
  /!\d+/, // Repeat patterns like !4
  /~+/, // Rest patterns
  /gm_\w+/, // General MIDI sounds
  /RolandTR\d+/, // Roland drum machine sounds
];

/**
 * Detects if code contains Strudel-specific syntax
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isStrudelCode(code) {
  return STRUDEL_PATTERNS.some((pattern) => pattern.test(code));
}

/** Puts statements glued together on lines of their own. */
function splitGluedStatements(code) {
  const split = code
    // Add line breaks after function calls that end with ) followed by await/let/const/var/function
    .replace(/\)(await|let|const|var|function)\s/g, ')\n$1 ')
    // Add line breaks after semicolons followed by await/let/const/var/function
    .replace(/;(await|let|const|var|function)\s/g, ';\n$1 ')
    // Add line breaks after ) followed by any identifier (more general)
    .replace(/\)([a-zA-Z_$][a-zA-Z0-9_$]*)/g, ')\n$1')
    // Add line breaks before Strudel patterns (identifier:) when they follow )
    .replace(/\)([a-zA-Z_$][a-zA-Z0-9_$]*\s*:)/g, ')\n$1')
    // Add line breaks after } followed by identifiers
    .replace(/\}([a-zA-Z_$][a-zA-Z0-9_$]*)/g, '}\n$1');
  // Add line breaks after numbers followed by a glued statement (like "175let"), never inside a literal
  return splitGluedAfterNumbers(split);
}

/** The spacing rules, on a line of code without its indent. \uE000 opens a comment placeholder, which has its own. */
function normalizeSpacing(line) {
  return line
    .replace(/([^=!<>+\-*/%&|^?])=([^=>\uE000])/g, '$1 = $2') // Add spaces around = (not ==, !=, =>, +=, %=, ||=, ...)
    .replace(/([0-9])\s*([+\-*/])\s*([0-9])/g, '$1 $2 $3') // Add spaces around math operators between numbers only
    .replace(/,([^\s\uE000])/g, ', $1') // Add space after commas
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single
    .replace(/\s*;\s*/g, ';') // Normalize semicolons
    .replace(/\(\s+/g, '(') // Remove space after opening parentheses
    .replace(/\s+\)/g, ')') // Remove space before closing parentheses
    .replace(/\{\s+/g, '{ ') // Normalize space after opening braces
    .replace(/\s+\}/g, ' }'); // Normalize space before closing braces
}

/** Indents every line by its bracket depth and applies the spacing rules. */
function formatLines(code, indentStr) {
  const lines = code.split('\n');
  const formattedLines = [];
  let indentLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === '') {
      formattedLines.push('');
      continue;
    }

    // Handle closing brackets/parentheses - decrease indent before the line
    if (/^[})\]]/.test(line)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    let formatted = indentStr.repeat(indentLevel) + normalizeSpacing(line);

    // Handle opening brackets/parentheses - increase indent after the line
    if (/[{([]$/.test(withoutTrailingComments(line))) {
      indentLevel++;
    }

    // Handle method chaining - add proper indentation for continued lines
    if (line.startsWith('.') && i > 0) {
      formatted = indentStr.repeat(Math.max(0, indentLevel - 1)) + indentStr + line;
    }

    formattedLines.push(formatted);
  }

  return formattedLines.join('\n');
}

/**
 * Formats arrange() and stack() calls with multi-line argument lists. Works on text with placeholders, so a call in a
 * string or a comment is never seen; `tokens.restore` gives the text as it will be, for what depends on real lengths.
 */
function formatCompositionFunctions(code, options, tokens) {
  // Pattern matches: arrange(...), stack(...), .stack(...)
  const functionPattern = /(\b(arrange|stack)|\.stack)\s*\(/g;

  let result = code;
  const processedRanges = new Set(); // Track processed function calls to avoid infinite loop

  let match;
  functionPattern.lastIndex = 0;

  while ((match = functionPattern.exec(result)) !== null) {
    const functionName = match[1]; // 'arrange', 'stack', or '.stack'
    const startIndex = match.index;
    const openParenIndex = match.index + match[0].length - 1;

    // Find the matching closing parenthesis
    let depth = 1;
    let closeParenIndex = -1;
    for (let i = openParenIndex + 1; i < result.length; i++) {
      if (result[i] === '(') {
        depth++;
      } else if (result[i] === ')') {
        depth--;
        if (depth === 0) {
          closeParenIndex = i;
          break;
        }
      }
    }

    if (closeParenIndex === -1) {
      continue;
    }

    const rangeKey = `${startIndex}-${closeParenIndex}`;
    if (processedRanges.has(rangeKey)) {
      continue;
    }

    const argsContent = result.substring(openParenIndex + 1, closeParenIndex);

    // Already multi-line formatted, skip it
    if (tokens.restore(argsContent).includes('\n')) {
      processedRanges.add(rangeKey);
      continue;
    }

    // Split arguments by commas at depth 0 (not inside nested parentheses/brackets)
    const args = [];
    let currentArg = '';
    let argDepth = 0;
    let argCount = 0;
    let hasContent = false;
    for (const char of argsContent) {
      if ('([{'.includes(char)) {
        argDepth++;
      } else if (')]}'.includes(char)) {
        argDepth--;
      }
      if (char === ',' && argDepth === 0) {
        args.push(currentArg.trim());
        currentArg = '';
        argCount++;
      } else {
        currentArg += char;
        hasContent = hasContent || char.trim() !== '';
      }
    }
    const lastArg = currentArg.trim();
    if (hasContent) {
      argCount++;
    }

    // Skip formatting for single-argument or short calls
    const fullLength = tokens.restore(result.substring(startIndex, closeParenIndex + 1)).length;
    if (argCount <= 1 && fullLength <= options.printWidth) {
      continue;
    }

    // A trailing comma is code too: it stays
    if (lastArg) {
      args.push(lastArg);
    }
    const trailingComma = lastArg ? '' : ',';
    args.forEach((arg) => tokens.dropCommentIndent(arg));

    // Detect current indentation level by looking at the line containing the function call
    const lineStart = result.lastIndexOf('\n', startIndex) + 1;
    const baseIndent = result.substring(lineStart, startIndex).match(/^(\s*)/)?.[1] || '';
    const argIndent = baseIndent + indentOf(options);
    const formattedArgs = args.map((arg) => `${argIndent}${arg}`).join(',\n');
    const formattedCall = `${functionName}(\n${formattedArgs}${trailingComma}\n${baseIndent})`;

    result = result.substring(0, startIndex) + formattedCall + result.substring(closeParenIndex + 1);
    processedRanges.add(rangeKey);

    // Search from the beginning since the string changed
    functionPattern.lastIndex = 0;
  }

  return result;
}

function indentOf(options) {
  return options.useTabs ? '\t' : ' '.repeat(options.tabWidth);
}

function rewrite(code, options, { indent = '', firstLineIndent = indent } = {}) {
  const tokens = protectTokens(code);
  const spaced = formatLines(splitGluedStatements(tokens.code), indentOf(options));
  const composed = formatCompositionFunctions(spaced, options, tokens);
  const placed = composed
    .split('\n')
    .map((line, i) => (line === '' ? line : (i === 0 ? firstLineIndent : indent) + line))
    .join('\n');

  // Code that holds a lookalike of a placeholder: restoring would put a comment in the wrong place
  return tokens.intact(placed) ? tokens.restore(placed) : null;
}

// `$:` labels parse as JavaScript. As tolerant as acorn gets, so that a track's top-level await, import and return pass.
const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowHashBang: true,
};

/** The source text of every token, or null when the code doesn't parse. */
function parsedTokens(code) {
  const tokens = [];
  try {
    parse(code, { ...PARSE_OPTIONS, onToken: (token) => tokens.push(code.slice(token.start, token.end)) });
    return tokens;
  } catch {
    return null;
  }
}

const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * The check on what the formatter returns. It may only change whitespace, between tokens, and what comes out must be
 * code:
 * 1. the code without whitespace is identical, and so are its comments and strings, in order
 * 2. the output parses, whatever the input did: glued statements only parse once split, while unfinished code can
 *    read a comment as code, so it stays untouched until it parses again
 * 3. code that parsed keeps its tokens. That also holds regex literals, which nothing else knows.
 *
 * @param {string} input
 * @param {string} output
 * @returns {boolean}
 */
export function changesOnlyWhitespace(input, output) {
  if (input === output) {
    return true;
  }
  if (input.replace(/\s+/g, '') !== output.replace(/\s+/g, '')) {
    return false;
  }
  if (!sameList(literalsOf(input), literalsOf(output))) {
    return false;
  }
  const tokensAfter = parsedTokens(output);
  if (tokensAfter === null) {
    return false;
  }
  const tokensBefore = parsedTokens(input);
  return tokensBefore === null || sameList(tokensBefore, tokensAfter);
}

function refused() {
  console.warn('[StrudelFormat] Formatting would not have been safe, keeping the original');
  return { rejected: true };
}

/**
 * Formats Strudel code with basic formatting while preserving DSL syntax. If the result is anything but the same code
 * with other whitespace, the original comes back, marked as `rejected`.
 *
 * @param {string} code
 * @param {object} options the indent settings of the Prettier options; printWidth, for the composition functions
 * @returns {object} `formattedCode`, and `rejected` when the original came back
 */
export function formatStrudelCode(code, options) {
  const formatted = rewrite(code, options);
  if (formatted !== null && changesOnlyWhitespace(code, formatted)) {
    return { formattedCode: formatted };
  }
  return { formattedCode: code, ...refused() };
}

/**
 * Formats only the selected range, and leaves everything outside it byte for byte. The check is on the whole document,
 * as a selection rarely parses by itself. A selection starting or ending inside a string or a comment, or in a document
 * that doesn't parse, changes nothing and comes back marked as `rejected`.
 *
 * @param {string} code
 * @param {number} start
 * @param {number} end
 * @param {object} options
 * @returns {object} `formattedCode`, `cursorOffset` at the end of the formatted selection, and `rejected` when the
 * original came back
 */
export function formatStrudelSelection(code, start, end, options) {
  const selected = code.slice(start, end);
  if (selected.trim() === '') {
    return { formattedCode: code, cursorOffset: end };
  }
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const indent = code.slice(lineStart).match(/^[ \t]*/)[0];
  const startsLine = code.slice(lineStart, start).trim() === '';
  const firstLineIndent = startsLine ? indent.slice(start - lineStart) : selected.match(/^[ \t]*/)[0];
  const trailing = selected.match(/[ \t]*$/)[0];

  const formatted = rewrite(selected, options, { indent, firstLineIndent });
  if (formatted !== null) {
    const replacement = formatted + trailing;
    const result = code.slice(0, start) + replacement + code.slice(end);
    if (changesOnlyWhitespace(code, result)) {
      return { formattedCode: result, cursorOffset: start + replacement.length };
    }
  }
  return { formattedCode: code, cursorOffset: end, ...refused() };
}
