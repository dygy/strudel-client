import { isolateHistory } from '@codemirror/commands';

// A transaction that replaces all the text, as one Undo step of its own. Without the annotation, a change
// with no user event joins the step before it if it comes soon after, so Undo would go back past what was
// typed just before. The cursor stays where it was, as far as the new text allows.
// Plain comments: this is the editor's plumbing, not part of the language's reference.
export function wholeDocumentReplacement(state, code) {
  return {
    changes: { from: 0, to: state.doc.length, insert: code },
    selection: { anchor: Math.min(state.selection.main.head, code.length) },
    annotations: isolateHistory.of('full'),
  };
}
