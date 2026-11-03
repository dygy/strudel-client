/**
 * What a multitrack is: `steps` holds the text, `active_step` says which is open, `code` copies it.
 * Regression (data loss): saves wrote `code` alone, so edits never reached `steps`.
 */
import { describe, expect, it } from 'vitest';
import {
  activeStepIndex,
  consistentNewTrack,
  openingTrack,
  reconcileMultitrack,
  saveFieldsFor,
  stepsWithText,
} from '../multitrack';

const steps = () => [
  { id: 's1', name: 'A', code: 'aa', modified: 'old' },
  { id: 's2', name: 'B', code: 'bb', modified: 'old' },
];
const multi = (extra = {}) => ({ id: 't', code: 'aa', isMultitrack: true, steps: steps(), activeStep: 0, ...extra });

describe('saveFieldsFor', () => {
  it('a plain track sends its code and nothing else', () => {
    expect(saveFieldsFor({ code: 'x', isMultitrack: false, steps: [], activeStep: 0 }, 'y')).toEqual({ code: 'y' });
  });

  it('a multitrack sends the text in its step, and all three fields', () => {
    const fields = saveFieldsFor(multi({ activeStep: 1, code: 'bb' }), 'typed') as ReturnType<typeof multi>;
    expect(fields.code).toBe('typed');
    expect(fields.activeStep).toBe(1);
    expect(fields.steps.map((s) => s.code)).toEqual(['aa', 'typed']);
  });

  it('a flag saying multitrack with no steps is treated as plain', () => {
    expect(saveFieldsFor({ code: 'x', isMultitrack: true, steps: [] }, 'y')).toEqual({ code: 'y' });
  });
});

describe('stepsWithText', () => {
  it("touches only that step's timestamp, and only if its text changed", () => {
    const same = stepsWithText(steps(), 0, 'aa', 'now');
    expect(same[0].modified).toBe('old');
    const changed = stepsWithText(steps(), 0, 'new', 'now');
    expect(changed[0]).toMatchObject({ code: 'new', modified: 'now' });
    expect(changed[1].modified).toBe('old');
  });
});

describe('activeStepIndex', () => {
  it.each([
    [1, 1],
    [5, 0],
    [-1, 0],
    [null, 0],
    [1.5, 0],
  ])('active_step %j is step %i', (activeStep, expected) => {
    expect(activeStepIndex(multi({ activeStep }))).toBe(expected);
  });
});

describe('consistentNewTrack', () => {
  it('code follows the active step, which is how imports made the rows that disagree', () => {
    expect(consistentNewTrack(multi({ activeStep: 1, code: 'aa' })).code).toBe('bb');
  });

  it('leaves plain tracks alone', () => {
    const track = { code: 'x', isMultitrack: false };
    expect(consistentNewTrack(track)).toBe(track);
  });
});

describe('reconcileMultitrack (rows as prod has them)', () => {
  it('leaves a consistent row as it is', () => {
    const track = multi();
    expect(reconcileMultitrack(track, 'R')).toEqual(track);
  });

  it('active_step 1 with code equal to step 0: the editor shows step 1, and no text is lost', () => {
    const local = reconcileMultitrack(multi({ activeStep: 1, code: 'aa' }), 'R');
    expect(local.code).toBe('bb');
    expect(local.steps!.map((s) => s.code)).toEqual(['aa', 'bb']);
  });

  it('code matching no step is the only copy of old edits: it becomes a step', () => {
    const local = reconcileMultitrack(multi({ activeStep: 1, code: 'edited long ago' }), 'Recovered');
    expect(local.steps!.map((s) => s.code)).toEqual(['aa', 'bb', 'edited long ago']);
    expect(local.steps![2]).toMatchObject({ id: 't-recovered', name: 'Recovered' });
    expect(local.activeStep).toBe(1);
    expect(local.code).toBe('bb');
  });

  it('a second orphan gets its own id, never a duplicate of the first', () => {
    const once = reconcileMultitrack(multi({ code: 'first' }), 'R');
    const twice = reconcileMultitrack({ ...once, code: 'second' }, 'R');
    const ids = twice.steps!.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.steps!.map((step) => step.code)).toEqual(['aa', 'bb', 'first', 'second']);
  });

  it('empty code is nothing to recover', () => {
    expect(reconcileMultitrack(multi({ code: '  ' }), 'R').steps).toHaveLength(2);
  });

  it('gives the same result on every load', () => {
    const row = multi({ code: 'edited long ago' });
    expect(reconcileMultitrack(row, 'R')).toEqual(reconcileMultitrack(row, 'R'));
  });

  it('an active_step past the end falls back to the first step', () => {
    expect(reconcileMultitrack(multi({ activeStep: 9, code: 'aa' }), 'R')).toMatchObject({ activeStep: 0, code: 'aa' });
  });

  it('leaves a plain track alone', () => {
    const track = { id: 't', code: 'x', isMultitrack: false, steps: [] };
    expect(reconcileMultitrack(track, 'R')).toBe(track);
  });
});

describe('openingTrack', () => {
  it('opens the step the URL names', () => {
    expect(openingTrack(multi(), 'b', 'R')).toMatchObject({ activeStep: 1, code: 'bb' });
  });

  it('stays on the active step with no name, or a name it does not know', () => {
    expect(openingTrack(multi({ activeStep: 1, code: 'bb' }), null, 'R')).toMatchObject({ activeStep: 1, code: 'bb' });
    expect(openingTrack(multi({ activeStep: 1, code: 'bb' }), 'nope', 'R')).toMatchObject({ activeStep: 1 });
  });
});
