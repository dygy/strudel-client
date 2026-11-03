/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * An assistant's code enters the editor as its own Undo step, however soon after typing it comes.
 */
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { wholeDocumentReplacement } from '../replaceCode.mjs';

const start = (doc) => ({ state: EditorState.create({ doc, extensions: [history()] }) });
const apply = (holder, spec) => {
  holder.state = holder.state.update(spec).state;
};
const pressUndo = (holder) =>
  undo({
    state: holder.state,
    dispatch: (transaction) => {
      holder.state = transaction.state;
    },
  });

describe('wholeDocumentReplacement', () => {
  it('replaces all the text', () => {
    const holder = start('old text');
    apply(holder, wholeDocumentReplacement(holder.state, 'new'));
    expect(holder.state.doc.toString()).toBe('new');
  });

  it('brings back what was typed just before, not what was there before the typing', () => {
    const holder = start('saved');
    // No user event, as `setCode` sends: the kind of change that joins the step before it.
    apply(holder, { changes: { from: 5, insert: ' typed' } });
    apply(holder, wholeDocumentReplacement(holder.state, 'from an assistant'));
    expect(pressUndo(holder)).toBe(true);
    expect(holder.state.doc.toString()).toBe('saved typed');
  });

  it('keeps later typing out of its own step, so Undo removes only the typing', () => {
    const holder = start('saved');
    apply(holder, wholeDocumentReplacement(holder.state, 'code'));
    apply(holder, { changes: { from: 4, insert: '!' } });
    pressUndo(holder);
    expect(holder.state.doc.toString()).toBe('code');
  });

  it('keeps the cursor inside shorter text', () => {
    const holder = start('a long piece of text');
    apply(holder, { selection: { anchor: 15 } });
    apply(holder, wholeDocumentReplacement(holder.state, 'abc'));
    expect(holder.state.selection.main.head).toBe(3);
  });
});
