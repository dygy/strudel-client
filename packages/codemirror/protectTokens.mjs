// Private-use characters: a placeholder must not start with an identifier character or a digit, or `s("bd")// kick`
// would be split by the `)ident` rule. The digits inside are safe, the closing character ends their run.
const COMMENT_OPEN = '\uE000';
const COMMENT_CLOSE = '\uE001';
const STRING_OPEN = '\uE002';
const STRING_CLOSE = '\uE003';
const PLACEHOLDER = /\uE000(\d+)\uE001|\uE002(\d+)\uE003/g;
const TRAILING_COMMENTS = /(?:\uE000\d+\uE001\s*)+$/;
const LEADING_COMMENT = /^\uE000(\d+)\uE001/;

// `'` and `"` strings end at a raw newline, unless an escape consumes it: an unterminated quote reads as a plain
// character instead of pairing up with a quote in a later comment. Backtick strings span lines.
const STRING = /"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*'|`(?:\\[\s\S]|[^\\`])*`/.source;
// A line or block comment, or a line or paragraph separator, which JavaScript reads as a line ending and every
// whitespace rule would take for a space. Kept like a comment, so no rule gets to see it.
const COMMENT = /\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?(?:\*\/|$)|[\u2028\u2029]/.source;

// Leftmost match wins, so `"http://x"` stays a string and the apostrophe in `// don't` stays in its comment.
// The lookbehind tries a whitespace run once, from its start, so a long run costs linear time.
// Regex literals are out of scope: a quote or `//` inside one reads as a string or a comment here (in
// `x.replace(/'/g, "") // a ' b=c,d)e` a string runs into the comment). `changesOnlyWhitespace` catches what that does.
const TOKEN = new RegExp(`(?<![ \\t])([ \\t]*)(${COMMENT})|${STRING}`, 'g');

/**
 * Hides comments and strings from the Strudel formatter, whose line breaks and spacing rules must never touch them.
 * They split `// 640x384);chain` in two, and the tail became live code. Run it before anything else and restore last.
 *
 * A trailing comment takes the whitespace before it into the placeholder, so `foo();  // c` keeps its spacing against
 * the semicolon rule. A comment alone on its line leaves it out, so it is still re-indented.
 *
 * @param {string} code
 * @returns {object} `code` with placeholders; `intact(text)` says that `text` still holds each one, whole and in
 * order; `restore(text)` puts the tokens back; `dropCommentIndent(text)` removes the whitespace kept with a comment
 * that opens `text`, for a comment that has moved to the start of a line.
 */
export function protectTokens(code) {
  const tokens = [];
  const placeholders = [];
  const hide = (token, open, close) => {
    tokens.push(token);
    placeholders.push(`${open}${tokens.length - 1}${close}`);
    return placeholders[placeholders.length - 1];
  };

  const hidden = code.replace(TOKEN, (match, indent, comment, offset) => {
    if (comment === undefined) {
      return hide(match, STRING_OPEN, STRING_CLOSE);
    }
    const lineStart = code.lastIndexOf('\n', offset - 1) + 1;
    return code.slice(lineStart, offset).trim() === ''
      ? indent + hide(comment, COMMENT_OPEN, COMMENT_CLOSE)
      : hide(match, COMMENT_OPEN, COMMENT_CLOSE);
  });

  return {
    code: hidden,
    intact: (text) => {
      const found = text.match(PLACEHOLDER) ?? [];
      return found.length === placeholders.length && found.every((placeholder, i) => placeholder === placeholders[i]);
    },
    // In one pass with a callback: `$1` in a token stays literal, and a lookalike inside a token stays what it is.
    restore: (text) => text.replace(PLACEHOLDER, (match, comment, string) => tokens[comment ?? string] ?? match),
    dropCommentIndent: (text) => {
      const index = text.match(LEADING_COMMENT)?.[1];
      if (index !== undefined) {
        tokens[index] = tokens[index].trimStart();
      }
    },
  };
}

/**
 * The line without its trailing comments, for rules that look at how the code on it ends: `stack( // drums` opens a
 * level, `// foo (` does not.
 *
 * @param {string} line a line of `protectTokens` output
 * @returns {string}
 */
export function withoutTrailingComments(line) {
  return line.replace(TRAILING_COMMENTS, '');
}

/**
 * The comments and strings of some code, in order, without the whitespace in front of a comment.
 *
 * @param {string} code
 * @returns {string[]}
 */
export function literalsOf(code) {
  return Array.from(code.matchAll(TOKEN), (match) => match[2] ?? match[0]);
}
