/**
 * Bug (2026-10-29): picking another track in the library and pressing Update hot-swapped
 * it into the old track's timeline (no fades, same cycle position). Update must tell a
 * track switch from an in-place update of the playing track.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTrackSwitchController, getUpdateAction } from '../trackSwitch';

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
