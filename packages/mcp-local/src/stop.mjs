// Why a run stopped. These answers depend on what the sandbox reports and not on how late the machine
// is running, so that a loaded computer can't turn one kind of failure into another.

/**
 * Reads an error from the sandbox.
 * @param {{interrupted: boolean, message: string}} state whether the interrupt handler has stopped the code, and the error's message
 * @returns {{code: string}|undefined} why the run stopped, or undefined for an ordinary error in the code
 */
export function stopForError({ interrupted, message }) {
  if (interrupted || /interrupted/.test(message)) {
    return { code: 'time_limit' };
  }
  return /out of memory/i.test(message) ? { code: 'memory_limit' } : undefined;
}

/**
 * Decides what a run with no answer yet means.
 * @param {{interrupted: boolean, jobsPending: number, pastDeadline: boolean}} state the interrupt handler's verdict, the jobs just run, and the clock
 * @returns {{code: string}|undefined} why the run stopped, or undefined when it should carry on
 */
export function stopWithoutAnswer({ interrupted, jobsPending, pastDeadline }) {
  // Interrupting an async function can leave no error and no jobs.
  if (interrupted) {
    return { code: 'time_limit' };
  }
  // Nothing left to run and nothing that could wake it: the sandbox has no timers or I/O. It stays true
  // however late it is, so the clock must not be asked first.
  if (jobsPending === 0) {
    return { code: 'never_finished' };
  }
  // Jobs too small to reach the interrupt check, repeated forever.
  return pastDeadline ? { code: 'time_limit' } : undefined;
}
