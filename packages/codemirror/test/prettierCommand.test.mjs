// @vitest-environment jsdom
/**
 * The format command waits for its result. The editor may hold something else by then: applying the result would lose
 * what was typed, or put track A's text in track B, which the next autosave would then write to B.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const A = 'setcps(1)\nlet a=1';
const A_FORMATTED = 'setcps(1)\nlet a = 1';

const MESSAGES = {
  'messages:prettierFormatSuccess': 'T-success',
  'messages:prettierFormatError': 'T-error {error}',
  'messages:prettierFormatRejected': 'T-rejected',
};
const ENGINE = '../../../website/src/repl/formatEngine.ts';
const SETTINGS = '../../../website/src/settings.ts';
const I18N = '../../../website/src/i18n/i18n.ts';

let formatCommand;
let finish;
const formatCode = vi.fn();
let view;

beforeAll(async () => {
  Range.prototype.getClientRects = () => [];
  Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  vi.resetModules();
  vi.doMock(ENGINE, () => ({
    formatEngine: { formatCode, formatSelection: formatCode },
    createPrettierOptions: () => ({}),
  }));
  vi.doMock(SETTINGS, () => ({ settingsMap: { get: () => ({ isPrettierEnabled: 'true' }) } }));
  vi.doMock(I18N, () => ({ default: { t: (key) => MESSAGES[key] ?? key } }));
  ({ formatCommand } = await import('../prettierExtension.mjs'));
});

afterAll(() => {
  [ENGINE, SETTINGS, I18N].forEach((id) => vi.doUnmock(id));
  vi.resetModules();
});

beforeEach(() => {
  formatCode.mockReset();
  formatCode.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  view = new EditorView({ state: EditorState.create({ doc: A, extensions: [history()] }), parent: document.body });
});

afterEach(() => {
  view.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const text = () => view.state.doc.toString();
const shown = () => document.body.textContent;
const replaceAll = (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });

/** Runs the command, changes the editor during the wait, then lets the result arrive. */
async function runWith(duringTheWait, result = { success: true, formattedCode: A_FORMATTED }) {
  const running = formatCommand.run(view);
  await vi.waitFor(() => expect(formatCode).toHaveBeenCalled());
  duringTheWait();
  finish(result);
  return running;
}

describe('a result that arrives for text no longer in the editor is dropped', () => {
  it('typed during the wait: the typing stays', async () => {
    await runWith(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '23' } }));
    expect(text()).toBe(`${A}23`);
    expect(shown()).not.toContain('T-success');
  });

  it('a switch to a longer track: its text stays', async () => {
    const B = `setcps(2)\n${'// track b\n'.repeat(50)}let b=2`;
    await runWith(() => replaceAll(B));
    expect(text()).toBe(B);
    expect(shown()).not.toContain('T-success');
  });

  it('a switch to a shorter track: its text stays', async () => {
    await runWith(() => replaceAll('b'));
    expect(text()).toBe('b');
    expect(shown()).not.toContain('T-success');
  });

  it('a failure for that text says nothing either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runWith(() => replaceAll('b'), { success: false, error: 'boom' });
    expect(text()).toBe('b');
    expect(shown()).not.toContain('boom');
  });
});

describe('a result for the text in the editor', () => {
  it('is applied', async () => {
    await runWith(() => {});
    expect(text()).toBe(A_FORMATTED);
    expect(shown()).toContain('T-success');
  });

  it('nothing to change is still a success', async () => {
    await runWith(() => {}, { success: true, formattedCode: A });
    expect(text()).toBe(A);
    expect(shown()).toContain('T-success');
  });

  it('refused by the safety net: the text stays and the message says so, not success', async () => {
    await runWith(() => {}, { success: true, formattedCode: A, rejected: true });
    expect(text()).toBe(A);
    expect(shown()).toContain('T-rejected');
    expect(shown()).not.toContain('T-success');
  });
});
