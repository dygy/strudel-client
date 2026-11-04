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

const isSpace = (char) => char !== undefined && char.trim() === '';

// The whitespace runs that differ, or null if the two texts differ in anything but whitespace.
function whitespaceChanges(before, after) {
  const changes = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const from = i;
    const fromAfter = j;
    while (isSpace(before[i])) i++;
    while (isSpace(after[j])) j++;
    if (before.slice(from, i) !== after.slice(fromAfter, j)) {
      changes.push({ from, to: i, insert: after.slice(fromAfter, j) });
    }
    if (i === before.length && j === after.length) {
      break;
    }
    if (before[i] !== after[j]) {
      return null;
    }
    i++;
    j++;
  }
  return changes;
}

// Everything between what the two texts have the same at both ends.
function middleChange(before, after) {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  if (start === before.length && start === after.length) {
    return [];
  }
  return [{ from: start, to: before.length - end, insert: after.slice(start, after.length - end) }];
}

// A transaction for formatted text, as one Undo step of its own: it changes only what differs, so the editor itself
// maps the cursor, the selection and the scroll anchor over it. A format of Strudel code only moves whitespace, so each
// stays on the same character. Prettier may change more, and a place inside what changed goes to its edge.
export function formattedReplacement(view, code) {
  const before = view.state.doc.toString();
  const changes = whitespaceChanges(before, code) ?? middleChange(before, code);
  // Effects in a transaction speak of the text after its changes, and a snapshot of the text before them
  const snapshot = view.scrollSnapshot?.().map(view.state.changes(changes));
  return {
    changes,
    annotations: isolateHistory.of('full'),
    ...(snapshot && { effects: snapshot }),
  };
}

// Whether putting in formatted text would delete or change whitespace touching the cursor. An autosave can come right
// after a space was typed: `let ` would lose it, and the next letter would give `letx`.
export function formatTouchesCursor(state, code) {
  const before = state.doc.toString();
  const changes = whitespaceChanges(before, code) ?? middleChange(before, code);
  const places = state.selection.ranges.flatMap((range) => [range.from, range.to]);
  return places.some((place) =>
    changes.some(
      ({ from, to }) =>
        from <= place &&
        place <= to &&
        ((place > from && isSpace(before[place - 1])) || (place < to && isSpace(before[place]))),
    ),
  );
}
