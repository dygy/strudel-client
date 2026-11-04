/**
 * The format command: what it says, in the user's language, and that a parse error leaves the code alone.
 * `window.strudelTranslations` was read and nothing ever set it, so every message was the English fallback.
 *
 * @vitest-environment jsdom
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let formatCommand: typeof import('../../../../packages/codemirror/prettierExtension.mjs').formatCommand;
let autoFormatOnSave: typeof import('../../../../packages/codemirror/prettierExtension.mjs').autoFormatOnSave;

const translations: Record<string, string> = {
  'messages:prettierFormatSuccess': 'T-success',
  'messages:prettierFormatError': 'T-error {error}',
  'messages:prettierFormatting': 'T-formatting',
  'messages:prettierFormatRejected': 'T-rejected',
};

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../../settings', () => ({ settingsMap: { get: () => ({ isPrettierEnabled: 'true' }) } }));
  vi.doMock('../../i18n/i18n', () => ({ default: { t: (key: string) => translations[key] ?? key } }));
  ({ formatCommand, autoFormatOnSave } = await import('../../../../packages/codemirror/prettierExtension.mjs'));
});

afterAll(() => {
  vi.doUnmock('../../settings');
  vi.doUnmock('../../i18n/i18n');
  vi.resetModules();
});

afterEach(() => {
  document.body.innerHTML = '';
});

const viewOf = (code: string) => ({
  dispatch: vi.fn(),
  state: {
    doc: { toString: () => code, length: code.length },
    selection: { main: { empty: true, head: 0, from: 0, to: 0 } },
    sliceDoc: () => '',
  },
});

describe('the format command says, translated', () => {
  it('that it worked', async () => {
    await formatCommand.run(viewOf('setcps(1)\nlet a=1'));
    expect(document.body.textContent).toContain('T-success');
  });

  it('that it failed, with the reason, and leaves the code', async () => {
    const view = viewOf('let = ;');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await formatCommand.run(view);
    expect(document.body.textContent).toContain('T-error Invalid JavaScript/TypeScript syntax');
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('that it is busy, on a large file', async () => {
    await formatCommand.run(viewOf(`setcps(1)\nlet a=1\n${'// filler\n'.repeat(200)}`));
    expect(document.body.textContent).toContain('T-formatting');
    expect(document.body.textContent).not.toContain('Formatting...');
  });
});

describe('code that could not be formatted safely, through the real formatter', () => {
  const REFUSED = 'setcps(1)\ns("bd"\nlet a=1';

  it('the command leaves it and says so', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = viewOf(REFUSED);
    await formatCommand.run(view);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('T-rejected');
    expect(document.body.textContent).not.toContain('T-success');
  });

  it('a save gets it back as typed, marked as refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const on = { isPrettierEnabled: 'true', prettierAutoFormatOnSave: 'true' };
    await expect(autoFormatOnSave(REFUSED, on)).resolves.toEqual({
      success: true,
      formattedCode: REFUSED,
      rejected: true,
    });
  });
});

describe('a parse error on save', () => {
  it('is a failure that hands back the code as it was', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const on = { isPrettierEnabled: 'true', prettierAutoFormatOnSave: 'true' };
    await expect(autoFormatOnSave('let = ;', on)).resolves.toEqual({
      success: false,
      formattedCode: 'let = ;',
      error: 'Invalid JavaScript/TypeScript syntax',
    });
  });
});

describe('the locales', () => {
  const locales = import.meta.glob('../../i18n/locales/*/*.json', { eager: true, import: 'default' });

  it('no text names the old shortcut', () => {
    const named = Object.entries(locales).filter(([, json]) =>
      /(Cmd|Ctrl|Mod)\s*[+-]\s*Q\b/i.test(JSON.stringify(json)),
    );
    expect(named.map(([path]) => path)).toEqual([]);
  });
});
