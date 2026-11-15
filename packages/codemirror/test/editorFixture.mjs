/**
 * Test support (not a test): a real CodeMirror editor with history, for website tests that need
 * the editor's text, undo history and read-only state (spec 030: the performance view keeps the
 * same editor). It lives here because `@codemirror/*` resolves from this package only.
 */
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, isolateHistory, undo } from '@codemirror/commands';

/**
 * Plain JSDoc types only: the docs build (jsdoc-json, run by `pnpm test` and `build:cloudflare`) parses
 * every packages/*.mjs and rejects TypeScript syntax such as `doc?:`.
 * @param {Object} options
 * @param {HTMLElement} options.parent - Where the editor mounts
 * @param {string} [options.doc] - Initial text
 * @param {boolean} [options.readOnly] - Read-only editor
 * @param {Function} [options.onKeyDown] - Called with each keydown the editor receives
 */
export function createTestEditor({ parent, doc = '', readOnly = false, onKeyDown = () => {} }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.domEventHandlers({
          keydown: (event) => {
            onKeyDown(event);
            return false;
          },
        }),
      ],
    }),
  });
  return {
    view,
    text: () => view.state.doc.toString(),
    /** Append `text` as one user edit (its own undo step). */
    type: (text) =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: text },
        userEvent: 'input.type',
        annotations: isolateHistory.of('full'),
        selection: { anchor: view.state.doc.length + text.length },
      }),
    undo: () => undo(view),
    readOnly: () => view.state.readOnly,
  };
}
