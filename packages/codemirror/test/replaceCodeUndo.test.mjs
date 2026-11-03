/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * @regression
 * "The typed text is saved first and Undo in the editor brings it back." `replaceCode.test.mjs` holds the
 * transaction. This holds the editor's method an assistant's code actually goes through.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';

// Loaded for this file only: under isolate:false, a copy left in the module cache would be what the
// mocks in bankAutocomplete.bugfix.test.mjs fail to reach.
let StrudelMirror;
beforeAll(async () => {
  vi.resetModules();
  ({ StrudelMirror } = await import('../codemirror.mjs'));
});
afterAll(() => vi.resetModules());

/** The real methods on a real editor state, with no view to draw it. */
function mirror(doc) {
  const instance = Object.create(StrudelMirror.prototype);
  instance.editor = {
    state: EditorState.create({ doc, extensions: [history()] }),
    dispatch(spec) {
      this.state = this.state.update(spec).state;
    },
  };
  return instance;
}
const text = (instance) => instance.editor.state.doc.toString();
const pressUndo = (instance) =>
  undo({
    state: instance.editor.state,
    dispatch: (transaction) => {
      instance.editor.state = transaction.state;
    },
  });

describe('StrudelMirror.replaceCode', () => {
  it("puts the assistant's code in the editor, and Undo brings back what was typed just before", () => {
    const instance = mirror('saved');
    instance.setCode('saved and typed');
    instance.replaceCode('from an assistant');
    expect(text(instance)).toBe('from an assistant');
    expect(pressUndo(instance)).toBe(true);
    expect(text(instance)).toBe('saved and typed');
  });

  it('typing after it stays out of its step, so Undo takes away the typing and not the code', () => {
    const instance = mirror('saved');
    instance.replaceCode('from an assistant');
    instance.setCode('from an assistant, typed');
    pressUndo(instance);
    expect(text(instance)).toBe('from an assistant');
  });
});
