/**
 * settingsMap is a persistentMap, so after a page reload its booleans are the strings 'true' and 'false'. Raw reads
 * took 'false' for on: Prettier turned off in Settings still formatted on save and on Cmd/Ctrl-Q, and every Prettier
 * checkbox set to off read as on.
 *
 * @vitest-environment jsdom
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const UNFORMATTED = 'setcps(0.5)\ns("bd")   ;x=1';
const FORMATTED = 'setcps(0.5)\ns("bd");x = 1';

let autoFormatOnSave: typeof import('../../../../packages/codemirror/prettierExtension.mjs').autoFormatOnSave;
let formatCommand: typeof import('../../../../packages/codemirror/prettierExtension.mjs').formatCommand;
let createPrettierOptions: typeof import('../formatEngine').createPrettierOptions;
let stored: Record<string, unknown> = {};

beforeAll(async () => {
  // The format command reads the store itself. isolate:false: fresh modules, so this mock applies and doesn't leak.
  vi.resetModules();
  vi.doMock('../../settings', () => ({ settingsMap: { get: () => stored } }));
  ({ autoFormatOnSave, formatCommand } = await import('../../../../packages/codemirror/prettierExtension.mjs'));
  ({ createPrettierOptions } = await import('../formatEngine'));
});

afterAll(() => {
  vi.doUnmock('../../settings');
  vi.resetModules();
});

describe('autoFormatOnSave', () => {
  it.each([
    ['false', 'true'],
    ['true', 'false'],
    ['false', 'false'],
  ])('leaves the code alone with isPrettierEnabled %s, prettierAutoFormatOnSave %s', async (enabled, onSave) => {
    const result = await autoFormatOnSave(UNFORMATTED, {
      isPrettierEnabled: enabled,
      prettierAutoFormatOnSave: onSave,
    });
    expect(result).toEqual({ success: true, formattedCode: UNFORMATTED });
  });

  it.each([
    ['strings', 'true'],
    ['booleans', true],
  ])('formats when both are on, as %s', async (_name, on) => {
    const result = await autoFormatOnSave(UNFORMATTED, { isPrettierEnabled: on, prettierAutoFormatOnSave: on });
    expect(result).toEqual({ success: true, formattedCode: FORMATTED });
  });

  it('leaves the code alone with real false', async () => {
    const result = await autoFormatOnSave(UNFORMATTED, { isPrettierEnabled: false, prettierAutoFormatOnSave: true });
    expect(result.formattedCode).toBe(UNFORMATTED);
  });
});

describe('the format command', () => {
  const editorHolding = (code: string) => ({
    dispatch: vi.fn(),
    state: {
      doc: { toString: () => code, length: code.length },
      selection: { main: { empty: true, head: 0, from: 0, to: 0 } },
    },
  });

  it('does nothing with Prettier off, stored as a string', async () => {
    stored = { isPrettierEnabled: 'false' };
    const view = editorHolding(UNFORMATTED);
    await expect(formatCommand.run(view)).resolves.toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('formats with Prettier on, stored as a string', async () => {
    stored = { isPrettierEnabled: 'true' };
    const view = editorHolding(UNFORMATTED);
    await expect(formatCommand.run(view)).resolves.toBe(true);
    expect(view.dispatch).toHaveBeenCalled();
  });
});

describe('createPrettierOptions', () => {
  const FLAGS = [
    ['prettierUseTabs', 'useTabs'],
    ['prettierSemi', 'semi'],
    ['prettierSingleQuote', 'singleQuote'],
    ['prettierBracketSpacing', 'bracketSpacing'],
  ] as const;

  it.each(FLAGS)('%s reads the strings and the booleans', (setting, option) => {
    expect(createPrettierOptions({ [setting]: 'false' })[option]).toBe(false);
    expect(createPrettierOptions({ [setting]: 'true' })[option]).toBe(true);
    expect(createPrettierOptions({ [setting]: false })[option]).toBe(false);
    expect(createPrettierOptions({ [setting]: true })[option]).toBe(true);
  });

  it('keeps the defaults when nothing is stored', () => {
    expect(createPrettierOptions({})).toMatchObject({
      useTabs: false,
      semi: true,
      singleQuote: false,
      bracketSpacing: true,
    });
  });
});
