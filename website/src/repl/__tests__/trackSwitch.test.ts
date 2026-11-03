/**
 * Bug (2026-10-29): picking another track in the library and pressing Update hot-swapped
 * it into the old track's timeline (no fades, same cycle position). Update must tell a
 * track switch from an in-place update of the playing track.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTrackSwitchController, getUpdateAction, STUCK_AFTER_MS } from '../trackSwitch';

describe('getUpdateAction (Update / Ctrl+U)', () => {
  it('a different track in the editor while one is playing is a track switch', () => {
    expect(getUpdateAction({ isPlaying: true, playingTrackId: 'track-a', editorTrackId: 'track-b' })).toBe('switch');
  });

  it('a library track picked while untracked code (e.g. from a URL) is playing is a track switch', () => {
    expect(getUpdateAction({ isPlaying: true, playingTrackId: null, editorTrackId: 'track-b' })).toBe('switch');
  });

  it('the playing track in the editor is an in-place hot-swap, never a switch', () => {
    expect(getUpdateAction({ isPlaying: true, playingTrackId: 'track-a', editorTrackId: 'track-a' })).toBe('hot-swap');
  });

  it('with nothing playing, Update just evaluates (no fade, no restart)', () => {
    expect(getUpdateAction({ isPlaying: false, playingTrackId: null, editorTrackId: 'track-b' })).toBe('hot-swap');
    expect(getUpdateAction({ isPlaying: false, playingTrackId: 'track-a', editorTrackId: 'track-b' })).toBe('hot-swap');
  });

  it('an editor track with no id is never treated as a different track', () => {
    expect(getUpdateAction({ isPlaying: true, playingTrackId: 'track-a', editorTrackId: '' })).toBe('hot-swap');
    expect(getUpdateAction({ isPlaying: true, playingTrackId: 'track-a', editorTrackId: undefined })).toBe('hot-swap');
  });
});

// ---------------------------------------------------------------------------
// The controller useReplContext drives (review of the 2026-10-29 fix): which track is
// playing, captured when its evaluate starts; double Updates during a switch.
// ---------------------------------------------------------------------------

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** A StrudelMirror stand-in: evaluate() is async and calls afterEval when the pattern lands. */
function setup() {
  const tracks = createTrackSwitchController();
  const repl = { started: false };
  let land = deferred();
  const editor = {
    code: '',
    evaluate: async () => {
      const code = editor.code; // StrudelMirror reads this.code when evaluate starts
      await land.promise; // transpile, samples(), setPattern…
      repl.started = true;
      tracks.evaluated(code); // afterEval
    },
  };
  tracks.attachEditor(editor);
  const load = (id: string, code: string) => {
    tracks.setEditorTrack(id); // handleUpdate(…, false)
    editor.code = code;
  };
  const play = async (id: string, code: string) => {
    load(id, code);
    land.resolve();
    await editor.evaluate();
    land = deferred();
  };
  const stop = () => {
    repl.started = false;
    tracks.stopped(); // onToggle(false)
  };
  const hotSwap = vi.fn(async () => {
    land.resolve();
    await editor.evaluate();
    land = deferred();
  });
  const update = (switchTrack: (code: string) => Promise<void> | void, reset = false) =>
    tracks.update({ reset, isPlaying: repl.started, code: editor.code, hotSwap, switchTrack });
  return { tracks, repl, editor, load, play, stop, hotSwap, update, landNow: () => land.resolve() };
}

describe('createTrackSwitchController', () => {
  it('Update on the track that is playing hot-swaps it in place', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.load('a', 's("bd sd")');
    const switchTrack = vi.fn();

    expect(await t.update(switchTrack)).toBe('hot-swap');
    expect(t.hotSwap).toHaveBeenCalledTimes(1);
    expect(switchTrack).not.toHaveBeenCalled();
  });

  it('Update after picking another track while one plays is a switch to that track', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.load('b', 's("hh")');
    const switchTrack = vi.fn();

    expect(await t.update(switchTrack)).toBe('switch');
    expect(switchTrack).toHaveBeenCalledWith('s("hh")', { reset: false });
    expect(t.hotSwap).not.toHaveBeenCalled();
  });

  it('the playing track is the one whose evaluate started, even if another track is picked before it lands', async () => {
    const t = setup();
    t.load('a', 's("bd")');
    const evaluating = t.editor.evaluate(); // Play / Ctrl+Enter on track A
    t.load('b', 's("hh")'); // the user picks B while A is still evaluating
    t.landNow();
    await evaluating;

    expect(t.tracks.playingTrackId).toBe('a');
    expect(t.tracks.decide(true)).toBe('switch'); // Update now switches A -> B, not hot-swaps B into A
  });

  it('a switch labels the track it switched to, even if another track is picked during the fade', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.load('b', 's("hh")');
    const fade = deferred();
    const switching = t.update(async (code) => {
      await fade.promise; // fade down…
      t.tracks.evaluated(code); // …then the new pattern lands
    });
    t.load('c', 's("cp")'); // picked mid-fade
    fade.resolve();
    await switching;

    expect(t.tracks.playingTrackId).toBe('b');
  });

  it('a second Update for the same track during a switch is ignored, so it never restarts twice', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.load('b', 's("hh")');
    const fade = deferred();
    const switchTrack = vi.fn(async (code: string) => {
      t.stop(); // the restart stops the scheduler mid-switch
      await fade.promise;
      t.tracks.evaluated(code);
    });

    const first = t.update(switchTrack);
    expect(await t.update(switchTrack)).toBe('ignored'); // double press / held Ctrl+U
    expect(switchTrack).toHaveBeenCalledTimes(1);
    expect(t.hotSwap).not.toHaveBeenCalled();
    fade.resolve();
    await first;

    // Once it has landed, Update on B is an ordinary in-place edit again.
    t.repl.started = true;
    expect(t.tracks.decide(true)).toBe('hot-swap');
  });

  it('Update for yet another track during a switch is still a switch (queued), not a hot-swap', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.load('b', 's("hh")');
    const fade = deferred();
    const switchTrack = vi.fn(async () => {
      t.stop();
      await fade.promise;
    });
    const first = t.update(switchTrack);
    t.load('c', 's("cp")');

    expect(t.tracks.decide(false)).toBe('switch');
    fade.resolve();
    await first;
  });

  it('stopping clears the playing track, so the next Update just evaluates', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    t.stop();

    expect(t.tracks.playingTrackId).toBeNull();
    t.load('b', 's("hh")');
    expect(t.tracks.decide(t.repl.started)).toBe('hot-swap');
  });

  it('re-loading the playing track with reset (PatternsTab) is an in-place hot-swap, not a restart', async () => {
    const t = setup();
    await t.play('a', 's("bd")');
    const switchTrack = vi.fn();

    expect(await t.update(switchTrack, true)).toBe('hot-swap');
    expect(switchTrack).not.toHaveBeenCalled();
  });

  it('loading a track with reset while nothing plays resets and evaluates it (switch path)', async () => {
    const t = setup();
    t.load('a', 's("bd")');
    const switchTrack = vi.fn();

    expect(await t.update(switchTrack, true)).toBe('switch');
    expect(switchTrack).toHaveBeenCalledWith('s("bd")', { reset: true });
  });
});

describe('replaceTrackId (spec 018: a deleted track saved again under a new id)', () => {
  it('keeps the next Update a hot-swap, with the same music playing', () => {
    const controller = createTrackSwitchController();
    controller.setEditorTrack('old');
    controller.evaluationStarted('code');
    controller.evaluated('code');
    controller.replaceTrackId('old', 'new');
    expect(controller.playingTrackId).toBe('new');
    expect(controller.editorTrackId).toBe('new');
    expect(controller.decide(true)).toBe('hot-swap');
  });

  it('an evaluate already under way lands on the new id', () => {
    const controller = createTrackSwitchController();
    controller.setEditorTrack('old');
    controller.evaluationStarted('code');
    controller.replaceTrackId('old', 'new');
    controller.evaluated('code');
    expect(controller.playingTrackId).toBe('new');
  });

  it('leaves other tracks alone', () => {
    const controller = createTrackSwitchController();
    controller.setEditorTrack('other');
    controller.evaluationStarted('code');
    controller.evaluated('code');
    controller.replaceTrackId('old', 'new');
    expect(controller.playingTrackId).toBe('other');
  });
});

describe('busy: is what is heard changing', () => {
  it('from the moment Update starts a switch until it has finished, for every transition type', async () => {
    const controller = createTrackSwitchController();
    controller.setEditorTrack('b');
    expect(controller.busy).toBe(false);
    let finish = () => {};
    const update = controller.update({
      isPlaying: true,
      code: 'new',
      hotSwap: async () => {},
      switchTrack: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    expect(controller.busy).toBe(true);
    finish();
    await update;
    expect(controller.busy).toBe(false);
  });

  it('while an evaluate is loading its samples, and after one that fails', async () => {
    const controller = createTrackSwitchController();
    let finish: (value?: unknown) => void = () => {};
    let refuse: (error: unknown) => void = () => {};
    const editor = {
      code: 'x',
      evaluate: () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    };
    controller.attachEditor(editor);
    const first = editor.evaluate();
    expect(controller.busy).toBe(true);
    finish();
    await first;
    await Promise.resolve();
    expect(controller.busy).toBe(false);
    const second = editor.evaluate();
    refuse(new Error('no'));
    await expect(second).rejects.toThrow('no');
    await Promise.resolve();
    expect(controller.busy).toBe(false);
  });
});

describe('Update can never go dead', () => {
  const NEVER = () => new Promise<void>(() => {});
  const setup = () => {
    const controller = createTrackSwitchController();
    const runs: string[] = [];
    const update = (code: string, switchTrack: (code: string) => Promise<void> = async (c) => void runs.push(c)) =>
      controller.update({ isPlaying: true, code, hotSwap: async () => void runs.push(`hot:${code}`), switchTrack });
    return { controller, runs, update };
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('a hanging track: Stop, fix it, Update runs; open another, edit, Update runs', async () => {
    const { controller, runs, update } = setup();
    controller.setEditorTrack('a');
    void update('hangs', NEVER);
    controller.stopped();
    expect(await update('fixed')).toBe('switch');
    expect(runs).toEqual(['fixed']);
    controller.setEditorTrack('b');
    expect(await update('another, edited')).toBe('switch');
    expect(runs).toEqual(['fixed', 'another, edited']);
  });

  it('a slow load: an edited Update goes through at once', async () => {
    const { runs, update, controller } = setup();
    controller.setEditorTrack('a');
    void update('slow', NEVER);
    expect(await update('slow, edited')).toBe('switch');
    expect(runs).toEqual(['slow, edited']);
  });

  it('only the very same code again is a repeat', async () => {
    const { runs, update, controller } = setup();
    controller.setEditorTrack('a');
    void update('same', NEVER);
    expect(await update('same')).toBe('ignored');
    expect(runs).toEqual([]);
  });

  it('a switch stuck in flight stops counting after the bound, for a repeat and for busy', async () => {
    const { runs, update, controller } = setup();
    controller.setEditorTrack('a');
    void update('same', NEVER);
    vi.setSystemTime(1_000_000 + STUCK_AFTER_MS - 1);
    expect(controller.busy).toBe(true);
    expect(controller.switchTarget).toBe('a');
    vi.setSystemTime(1_000_000 + STUCK_AFTER_MS);
    expect(controller.busy).toBe(false);
    expect(controller.switchTarget).toBeNull();
    expect(controller.decide(true, false, 'same')).not.toBe('ignored');
    expect(await update('same')).not.toBe('ignored');
    expect(runs).toHaveLength(1);
  });

  it('an evaluate that never finishes stops counting too', () => {
    const { controller } = setup();
    const editor = { code: 'x', evaluate: NEVER };
    controller.attachEditor(editor);
    void editor.evaluate();
    expect(controller.busy).toBe(true);
    vi.setSystemTime(1_000_000 + STUCK_AFTER_MS);
    expect(controller.busy).toBe(false);
  });

  it('forgets a switch once it finishes, even one that failed', async () => {
    const { update, controller } = setup();
    controller.setEditorTrack('a');
    await expect(update('x', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(controller.busy).toBe(false);
  });
});
