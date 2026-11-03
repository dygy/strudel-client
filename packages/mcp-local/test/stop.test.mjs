/*
@spec: 018-strudel-mcp-server
@regression
Which stop a run reports. A clock race used to decide this, so that a loaded machine could report
`never_finished` for a loop or `time_limit` for a dead promise. Every case is fixed here.
*/
import { describe, expect, it } from 'vitest';
import { stopForError, stopWithoutAnswer } from '../src/stop.mjs';

describe('a run with no answer yet', () => {
  it.each([
    // interrupted code can leave no error and no jobs: it still ran out of time
    [{ interrupted: true, jobsPending: 0, pastDeadline: true }, 'time_limit'],
    [{ interrupted: true, jobsPending: 0, pastDeadline: false }, 'time_limit'],
    [{ interrupted: true, jobsPending: 3, pastDeadline: true }, 'time_limit'],
    // nothing can wake it, however late the machine got here
    [{ interrupted: false, jobsPending: 0, pastDeadline: false }, 'never_finished'],
    [{ interrupted: false, jobsPending: 0, pastDeadline: true }, 'never_finished'],
    // jobs too small for the interrupt check
    [{ interrupted: false, jobsPending: 1024, pastDeadline: true }, 'time_limit'],
  ])('%o is %s', (state, code) => {
    expect(stopWithoutAnswer(state)).toEqual({ code });
  });

  it('carries on while jobs are left and time remains', () => {
    expect(stopWithoutAnswer({ interrupted: false, jobsPending: 1024, pastDeadline: false })).toBeUndefined();
  });
});

describe('an error from the sandbox', () => {
  it.each([
    [{ interrupted: true, message: 'anything' }, { code: 'time_limit' }],
    [{ interrupted: false, message: 'interrupted' }, { code: 'time_limit' }],
    [{ interrupted: false, message: 'out of memory' }, { code: 'memory_limit' }],
    [{ interrupted: false, message: "'x' is not defined" }, undefined],
  ])('%o gives %o', (state, expected) => {
    expect(stopForError(state)).toEqual(expected);
  });
});
