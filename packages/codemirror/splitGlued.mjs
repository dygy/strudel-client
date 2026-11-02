// A whole numeric literal: hex/binary/octal, decimal with fraction and exponent, separators, BigInt suffix.
const NUMBER =
  /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/;

/**
 * Puts a line break between a number and a statement glued to it ("175let x" -> "175\nlet x").
 *
 * Only a run that starts with a digit outside an identifier is looked at, and it is split after the whole numeric
 * literal: `1e-4`, `0x1f`, `10n` and identifiers like `bass2hit` or `o0` stay intact (a digit-then-letter rule split
 * `getTime() + 1e-4` into `1` and `e-4`, a syntax error).
 */
export function splitGluedAfterNumbers(code) {
  return code.replace(/(?<![\w$.])\d(?:[eE][+-]\d|[\w$.])*/g, (run) => {
    const num = run.match(NUMBER)[0];
    const rest = run.slice(num.length);
    return /^[a-zA-Z_$]/.test(rest) ? `${num}\n${rest}` : run;
  });
}
