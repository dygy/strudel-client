/**
 * @spec: 018-strudel-mcp-server (functional 2.8; tech 2.7)
 * What a tab does with a command, with the REPL and the file manager as stand-ins. How it sounds is
 * measured in a browser: nothing here touches audio, and these check that the buttons' own functions are
 * what gets called, and in what order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandHandler, errorLine, type TabControls } from '../handlers';
import type { TransitionPhase } from '../../transitionPhase';

type Log = string[];

function controlsWith(overrides: Partial<TabControls> = {}, log: Log = []) {
  const events = new EventTarget();
  const controls: TabControls = {
    enabled: () => true,
    isPlaying: () => true,
    cps: () => 0.5,
    transitionPhase: () => 'idle' as TransitionPhase,
    conflictOpen: () => false,
    currentTrack: () => ({ id: 't1', name: 'Song' }),
    playingAnotherTrack: () => false,
    hasUnsavedEdits: () => false,
    saveEdits: async () => void log.push('save'),
    replaceCode: (code) => void log.push(`replace:${code}`),
    start: async () => void log.push('start'),
    update: async () => void log.push('update'),
    stop: () => void log.push('stop'),
    evalError: () => null,
    openTrack: async (id) => (log.push(`open:${id}`), 'opened' as const),
    notify: (message) => void log.push(`notify:${message}`),
    events,
    ...overrides,
  };
  return { controls, handle: createCommandHandler(controls), log, events };
}

let log: Log;
beforeEach(() => {
  log = [];
});

describe('status', () => {
  it('says what the tab is doing', async () => {
    const { handle } = controlsWith();
    expect(await handle('status', {})).toEqual({
      ok: true,
      result: {
        track: { id: 't1', name: 'Song' },
        playing: true,
        cps: 0.5,
        transition: 'idle',
        changedElsewhere: false,
      },
    });
  });
});

describe('update_code', () => {
  it('on the track playing: replaces the text, then Update, and says so', async () => {
    const { handle } = controlsWith({}, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
    expect(log).toEqual(['replace:new', 'update', 'notify:updated']);
  });

  it('while stopped: changes the text and makes no sound', async () => {
    const { handle } = controlsWith({ isPlaying: () => false }, log);
    await handle('update_code', { code: 'new', trackId: 't1' });
    expect(log).toEqual(['replace:new', 'notify:updated']);
  });

  it('saves what was typed first', async () => {
    let unsaved = true;
    const { handle } = controlsWith(
      {
        hasUnsavedEdits: () => unsaved,
        saveEdits: async () => {
          log.push('save');
          unsaved = false;
        },
      },
      log,
    );
    await handle('update_code', { code: 'new', trackId: 't1' });
    expect(log).toEqual(['save', 'replace:new', 'update', 'notify:updated']);
  });

  it('refuses, and leaves the editor and the music alone, when that save fails', async () => {
    const { handle } = controlsWith({ hasUnsavedEdits: () => true }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'save_failed' });
    expect(log.filter((entry) => entry === 'save')).toHaveLength(3);
    expect(log.at(-1)).toBe('notify:refusedSave');
    expect(log.join()).not.toMatch(/replace|update/);
  });

  it('treats a save that throws the same way', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handle } = controlsWith(
      { hasUnsavedEdits: () => true, saveEdits: () => Promise.reject(new Error('x')) },
      log,
    );
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'save_failed' });
    error.mockRestore();
    expect(log.join()).not.toMatch(/replace/);
  });

  it('waits for a save already on its way, rather than refusing', async () => {
    let tries = 0;
    const { handle } = controlsWith(
      {
        hasUnsavedEdits: () => tries < 2,
        saveEdits: async () => {
          tries += 1;
        },
      },
      log,
    );
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
  });

  it('says conflict_open when the save is what found the track changed elsewhere', async () => {
    let conflict = false;
    const { handle } = controlsWith(
      {
        hasUnsavedEdits: () => true,
        conflictOpen: () => conflict,
        saveEdits: async () => {
          conflict = true;
        },
      },
      log,
    );
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'conflict_open' });
  });

  it('is refused during a transition, without touching anything', async () => {
    const { handle } = controlsWith({ transitionPhase: () => 'running' as const, hasUnsavedEdits: () => true }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({
      ok: false,
      code: 'transition_in_progress',
    });
    expect(log).toEqual(['notify:refusedTransition']);
  });

  it('is refused while a snapped switch is waiting too', async () => {
    const { handle } = controlsWith({ transitionPhase: () => 'waiting' }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({
      ok: false,
      code: 'transition_in_progress',
    });
  });

  it('is refused while the "changed elsewhere" message is open', async () => {
    const { handle } = controlsWith({ conflictOpen: () => true }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'conflict_open' });
    expect(log).toEqual(['notify:refusedConflict']);
  });

  it('is refused with no track open, as the code would have nowhere to be saved', async () => {
    const { handle } = controlsWith({ currentTrack: () => null }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'no_track_open' });
  });

  it('gives back a mistake with its line, keeps going, and says so in the tab', async () => {
    const mistake = Object.assign(new SyntaxError('Unexpected token (3:4)'), { loc: { line: 3, column: 4 } });
    const { handle } = controlsWith({ evalError: () => mistake }, log);
    expect(await handle('update_code', { code: 'bad', trackId: 't1' })).toEqual({
      ok: false,
      code: 'code_error',
      error: { message: 'Unexpected token (3:4)', line: 3 },
    });
    expect(log).toEqual(['replace:bad', 'update', 'notify:codeError']);
  });

  it('answers once a switch is under way, rather than waiting out a long transition', async () => {
    const { handle, events } = controlsWith({ update: () => new Promise(() => {}) }, log);
    const reply = handle('update_code', { code: 'new', trackId: 't1' });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve));
    events.dispatchEvent(new Event('track-transition-waiting'));
    expect(await reply).toMatchObject({ ok: true });
  });

  it('gives back a mistake in a new track that a transition found', async () => {
    const events = new EventTarget();
    const { handle } = controlsWith(
      {
        events,
        update: async () => {
          events.dispatchEvent(
            new CustomEvent('track-transition-error', { detail: { error: 'bad at line 2', evaluateFailed: true } }),
          );
        },
      },
      log,
    );
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({
      ok: false,
      code: 'code_error',
      error: { message: 'bad at line 2', line: 2 },
    });
  });
});

describe('a mistake found by a transition', () => {
  it("gives the evaluate's own error, which says where", async () => {
    const events = new EventTarget();
    const mistake = Object.assign(new SyntaxError('Unexpected token (2:6)'), { loc: { line: 2 } });
    const { handle } = controlsWith({
      events,
      playingAnotherTrack: () => true,
      evalError: () => mistake,
      update: async () => {
        events.dispatchEvent(
          new CustomEvent('track-transition-error', {
            detail: { error: 'The new track failed to evaluate', evaluateFailed: true },
          }),
        );
      },
    });
    expect(await handle('play', {})).toMatchObject({
      code: 'code_error',
      error: { message: 'Unexpected token (2:6)', line: 2 },
    });
  });
});

describe('play', () => {
  it('when stopped: what Play does', async () => {
    const { handle } = controlsWith({ isPlaying: () => false }, log);
    expect(await handle('play', {})).toMatchObject({ ok: true });
    expect(log).toEqual(['start', 'notify:played']);
  });

  it('with the same track playing: nothing to do, and nothing restarts', async () => {
    const { handle } = controlsWith({}, log);
    await handle('play', {});
    expect(log).toEqual(['notify:alreadyPlaying']);
  });

  it("with another track playing: what Update does, so it's the selected transition", async () => {
    const { handle } = controlsWith({ playingAnotherTrack: () => true }, log);
    await handle('play', {});
    expect(log).toEqual(['update', 'notify:played']);
  });

  it('is refused during a transition', async () => {
    const { handle } = controlsWith({ transitionPhase: () => 'running', playingAnotherTrack: () => true }, log);
    expect(await handle('play', {})).toEqual({ ok: false, code: 'transition_in_progress' });
    expect(log).toEqual(['notify:refusedTransition']);
  });

  it('gives back a mistake', async () => {
    const { handle } = controlsWith({
      isPlaying: () => false,
      evalError: () => new Error('[mini] parse error at line 4: x'),
    });
    expect(await handle('play', {})).toMatchObject({ code: 'code_error', error: { line: 4 } });
  });
});

describe('stop', () => {
  it('what Stop does', async () => {
    const { handle } = controlsWith({}, log);
    await handle('stop', {});
    expect(log).toEqual(['stop', 'notify:stopped']);
  });

  it("doesn't press the button when already stopped, as that would start it", async () => {
    const { handle } = controlsWith({ isPlaying: () => false }, log);
    await handle('stop', {});
    expect(log).toEqual(['notify:stopped']);
  });

  it('still works during a transition, as the button does', async () => {
    const { handle } = controlsWith({ transitionPhase: () => 'running' }, log);
    expect(await handle('stop', {})).toMatchObject({ ok: true });
    expect(log[0]).toBe('stop');
  });
});

describe('open_track', () => {
  it('saves first, opens, and leaves the music to carry on', async () => {
    let unsaved = true;
    const { handle } = controlsWith(
      {
        hasUnsavedEdits: () => unsaved,
        saveEdits: async () => {
          log.push('save');
          unsaved = false;
        },
      },
      log,
    );
    await handle('open_track', { trackId: 't2' });
    expect(log).toEqual(['save', 'open:t2', 'notify:opened']);
  });

  it('refuses when that save fails, and stays on this track', async () => {
    const { handle } = controlsWith({ hasUnsavedEdits: () => true }, log);
    expect(await handle('open_track', { trackId: 't2' })).toEqual({ ok: false, code: 'save_failed' });
    expect(log.join()).not.toMatch(/open:/);
  });

  it('says not_found for a track that is not there', async () => {
    const { handle } = controlsWith({ openTrack: async () => 'not_found' as const });
    expect(await handle('open_track', { trackId: 'absent' })).toEqual({ ok: false, code: 'not_found' });
  });

  it.each([
    ['a transition', { transitionPhase: () => 'running' as const }, 'transition_in_progress'],
    ['an open conflict', { conflictOpen: () => true }, 'conflict_open'],
  ])('is refused during %s', async (_label, overrides, code) => {
    const { handle } = controlsWith(overrides, log);
    expect(await handle('open_track', { trackId: 't2' })).toEqual({ ok: false, code });
  });
});

describe('order', () => {
  it('runs commands one at a time, so a second one never sees the first half done', async () => {
    let release = () => {};
    const { handle } = controlsWith(
      {
        update: () =>
          new Promise<void>((resolve) => {
            release = () => {
              log.push('first done');
              resolve();
            };
          }),
      },
      log,
    );
    const first = handle('update_code', { code: 'one', trackId: 't1' });
    const second = handle('update_code', { code: 'two', trackId: 't1' });
    await new Promise((resolve) => setTimeout(resolve));
    expect(log).toEqual(['replace:one']);
    release();
    await first;
    release();
    await second;
    expect(log.indexOf('first done')).toBeLessThan(log.indexOf('replace:two'));
  });

  it('answers status at once, even with a command under way', async () => {
    const { handle } = controlsWith({ update: () => new Promise(() => {}) });
    void handle('update_code', { code: 'one', trackId: 't1' });
    expect(await handle('status', {})).toMatchObject({ ok: true });
  });

  it('carries on after a command that threw', async () => {
    const { handle } = controlsWith({
      replaceCode: () => {
        throw new Error('no editor');
      },
    });
    await expect(handle('update_code', { code: 'x', trackId: 't1' })).rejects.toThrow('no editor');
    expect(await handle('status', {})).toMatchObject({ ok: true });
    expect(await handle('stop', {})).toMatchObject({ ok: true });
  });

  it('refuses a command it does not know', async () => {
    const { handle } = controlsWith();
    expect(await handle('format_disk', {})).toEqual({ ok: false, code: 'unknown_command' });
  });
});

describe('naming the track', () => {
  it('refuses when another track is open, and says which', async () => {
    const { handle } = controlsWith({ currentTrack: () => ({ id: 't2', name: 'Other' }) }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({
      ok: false,
      code: 'track_changed',
      openTrackId: 't2',
    });
    expect(log).toEqual(['notify:refusedTrackChanged']);
  });

  it('saves the track it names', async () => {
    const saved: string[] = [];
    let unsaved = true;
    const { handle } = controlsWith({
      hasUnsavedEdits: () => unsaved,
      saveEdits: async (id) => {
        saved.push(id);
        unsaved = false;
      },
    });
    await handle('update_code', { code: 'new', trackId: 't1' });
    expect(saved).toEqual(['t1']);
  });
});

describe('after every wait, all of it is asked again', () => {
  /** A save during which something happens. */
  const during = (happen: () => void, overrides: Partial<TabControls> = {}) => {
    let unsaved = true;
    return controlsWith(
      {
        hasUnsavedEdits: () => unsaved,
        saveEdits: async () => {
          unsaved = false;
          happen();
        },
        ...overrides,
      },
      log,
    );
  };

  it('the track changed during the save: nothing replaced', async () => {
    let open = 't1';
    const { handle } = during(() => (open = 't2'), { currentTrack: () => ({ id: open, name: open }) });
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ code: 'track_changed' });
    expect(log.join()).not.toMatch(/replace|update/);
  });

  it('the switch went off during the save: nothing replaced', async () => {
    let on = true;
    const { handle } = during(() => (on = false), { enabled: () => on });
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'control_off' });
    expect(log.join()).not.toMatch(/replace|update/);
  });

  it('a transition began during the save: nothing replaced', async () => {
    let phase: TransitionPhase | 'switching' = 'idle';
    const { handle } = during(() => (phase = 'switching'), { transitionPhase: () => phase });
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({
      code: 'transition_in_progress',
    });
    expect(log.join()).not.toMatch(/replace|update/);
  });

  it('a conflict opened during the save: nothing replaced', async () => {
    let conflict = false;
    const { handle } = during(() => (conflict = true), { conflictOpen: () => conflict });
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ code: 'conflict_open' });
    expect(log.join()).not.toMatch(/replace|update/);
  });

  it('the same for open_track', async () => {
    let on = true;
    const { handle } = during(() => (on = false), { enabled: () => on });
    expect(await handle('open_track', { trackId: 't2' })).toEqual({ ok: false, code: 'control_off' });
    expect(log.join()).not.toMatch(/open:/);
  });

  it('a switch that says nothing about a transition phase still counts', async () => {
    const { handle } = controlsWith({ transitionPhase: () => 'switching', playingAnotherTrack: () => true }, log);
    expect(await handle('play', {})).toEqual({ ok: false, code: 'transition_in_progress' });
    expect(log).toEqual(['notify:refusedTransition']);
  });
});

describe('only play changes what is heard', () => {
  it('update_code on a track that is not the one playing: text only, and it says so', async () => {
    const { handle } = controlsWith({ playingAnotherTrack: () => true }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({
      ok: true,
      result: { heard: false, ran: false },
    });
    expect(log).toEqual(['replace:new', 'notify:updatedNotHeard']);
  });

  it('update_code on the track playing says it was heard', async () => {
    const { handle } = controlsWith({}, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({
      result: { heard: true, ran: true },
    });
  });

  it('while stopped, says it was not', async () => {
    const { handle } = controlsWith({ isPlaying: () => false }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ result: { heard: false } });
  });
});

describe('ok means the code ran', () => {
  it('says so when Update ignored it', async () => {
    const { handle } = controlsWith({ update: async () => 'ignored' }, log);
    expect(await handle('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'ignored' });
    expect(log).not.toContain('notify:updated');
  });

  it('says it may not have, when it was still loading as the wait ran out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { handle } = controlsWith({ update: () => new Promise(() => {}) });
    const reply = handle('update_code', { code: 'new', trackId: 't1' });
    await vi.advanceTimersByTimeAsync(4_000);
    vi.useRealTimers();
    expect(await reply).toMatchObject({ ok: true, result: { ran: false, heard: false } });
  });
});

describe('turning off', () => {
  it('cancels what was waiting its turn', async () => {
    let on = true;
    let finishFirst = () => {};
    const { handle } = controlsWith(
      {
        enabled: () => on,
        update: () => new Promise<void>((resolve) => (finishFirst = resolve)),
        isPlaying: () => true,
        playingAnotherTrack: () => true,
      },
      log,
    );
    const first = handle('play', {});
    const second = handle('update_code', { code: 'queued', trackId: 't1' });
    const third = handle('open_track', { trackId: 't2' });
    await new Promise((resolve) => setTimeout(resolve));
    on = false;
    finishFirst();
    await first;
    expect(await second).toEqual({ ok: false, code: 'control_off' });
    expect(await third).toEqual({ ok: false, code: 'control_off' });
    expect(log.join()).not.toMatch(/replace|open:/);
  });

  it('refuses stop too, and does not press anything', async () => {
    const { handle } = controlsWith({ enabled: () => false }, log);
    expect(await handle('stop', {})).toEqual({ ok: false, code: 'control_off' });
    expect(log).toEqual([]);
  });
});

describe('opening honestly', () => {
  it.each(['library_unavailable', 'open_failed'] as const)('says %s, as a refusal', async (result) => {
    const { handle } = controlsWith({ openTrack: async () => result }, log);
    expect(await handle('open_track', { trackId: 't2' })).toEqual({ ok: false, code: result });
    expect(log).toEqual(['notify:refusedOpen']);
  });

  it('answers with the track it opened', async () => {
    let open = 't1';
    const { handle } = controlsWith({
      currentTrack: () => ({ id: open, name: open }),
      openTrack: async (id) => {
        open = id;
        return 'opened';
      },
    });
    expect(await handle('open_track', { trackId: 't2' })).toMatchObject({
      ok: true,
      result: { track: { id: 't2', name: 't2' } },
    });
  });
});

describe('errorLine', () => {
  it.each([
    [{ loc: { line: 7 } }, 7],
    [new Error('[mini] parse error at line 3: Expected'), 3],
    [new SyntaxError('Unexpected token (12:4)'), 12],
    [new Error('foo is not defined'), null],
  ])('%s', (error, line) => {
    expect(errorLine(error)).toBe(line);
  });
});
