// @vitest-environment jsdom
/**
 * Format on save replaced the whole text with `setCode`: the cursor jumped, and Undo could join what was typed before
 * it. The manual command guessed the cursor from a ratio of the lengths. A format only moves whitespace, so only
 * whitespace is changed, and the editor maps the cursor, the selection and the scroll anchor by itself.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { formatTouchesCursor, formattedReplacement } from '../replaceCode.mjs';

let view;

function open(doc, ...extensions) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), EditorState.allowMultipleSelections.of(true), ...extensions],
    }),
    parent: document.body,
  });
  return view;
}

beforeAll(() => {
  // jsdom has no layout
  Range.prototype.getClientRects = () => [];
  Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
});

afterEach(() => view?.destroy());

const BEFORE = 'setcps(1)\nlet a=1;let   b=2\n\nfoo(\ns("bd"),\nx)';
const AFTER = 'setcps(1)\nlet a = 1;\nlet b = 2\n\nfoo(\n  s("bd"),\n  x)';
const cursorAt = (text, needle, offset = 0) => text.indexOf(needle) + offset;

describe('formattedReplacement', () => {
  it('produces the formatted text', () => {
    open(BEFORE);
    view.dispatch(formattedReplacement(view, AFTER));
    expect(view.state.doc.toString()).toBe(AFTER);
  });

  it('keeps the cursor on the same character', () => {
    open(BEFORE);
    view.dispatch({ selection: { anchor: cursorAt(BEFORE, 's("bd")', 3) } });
    view.dispatch(formattedReplacement(view, AFTER));
    expect(view.state.selection.main.head).toBe(cursorAt(AFTER, 's("bd")', 3));
  });

  it('keeps a selection and every range of it', () => {
    open(BEFORE);
    const a = cursorAt(BEFORE, 'setcps');
    const b = cursorAt(BEFORE, 'foo');
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.range(a, a + 6), EditorSelection.range(b, b + 3)], 1),
    });
    view.dispatch(formattedReplacement(view, AFTER));
    const [first, second] = view.state.selection.ranges;
    expect(view.state.sliceDoc(first.from, first.to)).toBe('setcps');
    expect(view.state.sliceDoc(second.from, second.to)).toBe('foo');
  });

  it('changes only the whitespace that differs', () => {
    open(BEFORE);
    const { changes } = formattedReplacement(view, AFTER);
    expect(changes.every(({ from, to }) => BEFORE.slice(from, to).trim() === '')).toBe(true);
    expect(changes.every(({ insert }) => insert.trim() === '')).toBe(true);
  });

  it('is its own Undo step, and Undo brings back what was typed just before', () => {
    open('setcps(1)\nfoo(\n');
    // Right where the format changes something: the kind of change that would join the step before it.
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'x)' } });
    view.dispatch(formattedReplacement(view, 'setcps(1)\nfoo(\n  x)'));
    undo(view);
    expect(view.state.doc.toString()).toBe('setcps(1)\nfoo(\nx)');
  });

  it('keeps the scroll position, on the same code in the new text', () => {
    open(BEFORE);
    vi.spyOn(view, 'scrollSnapshot').mockReturnValue(EditorView.scrollIntoView(cursorAt(BEFORE, 'foo')));
    const { effects } = formattedReplacement(view, AFTER);
    expect(effects.value.range.from).toBe(cursorAt(AFTER, 'foo'));
  });

  it('text that differs beyond whitespace, as from Prettier, keeps what is the same at both ends', () => {
    open('const a = "x";\nlet b=1\nfoo()');
    const before = view.state.doc.toString();
    view.dispatch({ selection: { anchor: cursorAt(before, 'foo', 1) } });
    const after = "const a = 'x';\nlet b = 1;\nfoo()";
    view.dispatch(formattedReplacement(view, after));
    expect(view.state.doc.toString()).toBe(after);
    expect(view.state.selection.main.head).toBe(cursorAt(after, 'foo', 1));
  });

  it('no change is no transaction content', () => {
    open(BEFORE);
    expect(formattedReplacement(view, BEFORE).changes).toEqual([]);
  });
});

describe('formatTouchesCursor', () => {
  const at = (doc, pos) => EditorState.create({ doc, selection: { anchor: pos } });

  it('a just-typed space: formatting would eat it, and the next letter would join the word', () => {
    const doc = 'setcps(1)\nlet a=1 ';
    const after = 'setcps(1)\nlet a = 1';
    expect(formatTouchesCursor(at(doc, doc.length), after)).toBe(true);

    // What that would do, on the real transaction
    open(doc);
    view.dispatch({ selection: { anchor: doc.length } });
    view.dispatch(formattedReplacement(view, after));
    const { head } = view.state.selection.main;
    view.dispatch({ changes: { from: head, insert: 'x' } });
    expect(view.state.doc.toString()).toBe('setcps(1)\nlet a = 1x');
  });

  it.each([
    ['at the end of whitespace that changes', 'foo(\n    |x)', 'foo(\n  x)', true],
    ['in whitespace that changes', 'a;  | \nb', 'a;\nb', true],
    ['at the start of whitespace that changes', 'a;|   \nb', 'a;\nb', true],
    ['on the same line, away from what changes', 'let| a=1   ', 'let a = 1', false],
    ['in code', 'let a|b=1', 'let ab = 1', false],
    ['where only a space is added', 'let a|=1', 'let a = 1', false],
    ['nothing changes', 'let a = 1 |', 'let a = 1 ', false],
    ['next to whitespace that stays', 'let a = |1;   ', 'let a = 1;', false],
    ['prettier, in code that changes', 'let a|="x"\n', "let a = 'x';\n", false],
    ['prettier, after a space that goes', 'let a="x" |', "let a = 'x';", true],
  ])('a cursor %s', (_name, marked, after, expected) => {
    const pos = marked.indexOf('|');
    expect(formatTouchesCursor(at(marked.replace('|', ''), pos), after)).toBe(expected);
  });

  it('any range of a selection counts', () => {
    const state = EditorState.create({
      doc: 'a;   \nb c',
      selection: EditorSelection.create([EditorSelection.cursor(8), EditorSelection.cursor(5)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(formatTouchesCursor(state, 'a;\nb c')).toBe(true);
  });
});

describe('the format shortcut', () => {
  const press = (init) => runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor');

  it('is Shift-Alt-F, and Cmd-Q and Ctrl-Q, which quit the browser, are left alone', async () => {
    vi.resetModules();
    const { prettierKeymap, formatCommand } = await import('../prettierExtension.mjs');
    vi.spyOn(formatCommand, 'run').mockReturnValue(true);
    open('x', prettierKeymap());
    expect(press({ key: 'q', code: 'KeyQ', keyCode: 81, metaKey: true })).toBe(false);
    expect(press({ key: 'q', code: 'KeyQ', keyCode: 81, ctrlKey: true })).toBe(false);
    expect(formatCommand.run).not.toHaveBeenCalled();
    expect(press({ key: 'F', code: 'KeyF', keyCode: 70, shiftKey: true, altKey: true })).toBe(true);
    expect(formatCommand.run).toHaveBeenCalledOnce();
    vi.resetModules();
  });
});
