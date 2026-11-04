/**
 * `validateSyntax` didn't await `prettier.format`, so a parse error never reached its catch: invalid code was reported
 * as valid, with an unhandled rejection besides.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';
import {
  formatCode as formatInWorker,
  validateSyntax as validateInWorker,
} from '../../../../packages/codemirror/prettierWorker.mjs';

const options: PrettierOptions = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  printWidth: 120,
};

const copies = [
  [
    'main thread',
    (code: string) => FormatEngine.getInstance().validateSyntax(code),
    (code: string) => FormatEngine.getInstance().formatCode(code, options),
  ],
  ['worker', (code: string) => validateInWorker(code), (code: string) => formatInWorker(code, options)],
] as const;

describe.each(copies)('%s', (_copy, validate, format) => {
  it('invalid code is not valid', async () => {
    await expect(validate('let = ;')).resolves.toBe(false);
  });

  it('valid code is, in JavaScript and in TypeScript', async () => {
    await expect(validate('let a = 1')).resolves.toBe(true);
    await expect(validate('let a: number = 1')).resolves.toBe(true);
  });

  it('a parse error is a failed format that holds no code', async () => {
    const result = await format('let = ;');
    expect(result).toEqual({ success: false, error: 'Invalid JavaScript/TypeScript syntax' });
  });

  it('plain code still goes through Prettier', async () => {
    await expect(format('let   a=1')).resolves.toEqual({ success: true, formattedCode: 'let a = 1;\n' });
  });
});
