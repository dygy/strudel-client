// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * @regression
 * A command from the socket through the real hook and handlers, down to what the user's own buttons call.
 * `handlers.test.ts` holds the logic with fake controls: this holds which buttons those controls are, as
 * the audio is only what it should be if an update is the Update button and not a plain evaluate.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let conflictOpen = false;

vi.resetModules();
vi.doMock('@src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'a.b.c', user: { id: '11111111-1111-4111-8111-111111111111' } } },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.doMock('../../trackConflict', () => ({ hasOpenTrackConflict: () => conflictOpen }));

const { useAssistantControl } = await import('../useAssistantControl');
const { assistantControlOn, setAssistantControl } = await import('../store');
const { toastActions } = await import('@src/stores/toastStore');
const { default: i18n } = await import('@src/i18n/i18n');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 1;
  sent: Array<{ type?: string; id?: string; answer?: Record<string, unknown> }> = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {}
}

/** What the user's buttons and the file manager call, in the order they were called. */
const calls: string[] = [];
const called = <T,>(name: string, value?: T) =>
  vi.fn(async () => {
    calls.push(name);
    return value;
  });

const world = () => ({
  playing: true,
  playingTrack: 't1',
  unsaved: false,
  saveWorks: true,
});
let state = world();

const context = {
  editorRef: {
    current: {
      get repl() {
        return { scheduler: { started: state.playing, cps: 0.5 }, state: { evalError: null } };
      },
      replaceCode: vi.fn((code: string) => calls.push(`replaceCode:${code}`)),
      setCode: vi.fn((code: string) => calls.push(`setCode:${code}`)),
      evaluate: called('editor.evaluate'),
    },
  },
  // The button also stops a headphone preview, so commands use what's behind it.
  handleEvaluate: called('the Update button itself'),
  runUpdate: called('Update'),
  handleTogglePlay: called('Stop'),
  trackIds: () => ({ editor: 't1', playing: state.playingTrack }),
};
const fileManager = {
  selectedTrack: 't1',
  tracks: { t1: { id: 't1', name: 'Song' } },
  hasUnsavedEdits: () => state.unsaved,
  saveSpecificTrack: vi.fn(async (trackId: string, showToast: boolean) => {
    calls.push(`save:${trackId}:${showToast}`);
    if (state.saveWorks) state.unsaved = false;
    return state.saveWorks;
  }),
};

function Harness() {
  useAssistantControl(context, fileManager, false);
  return null;
}

let root: Root;
let socket: FakeSocket;
let nextId = 0;

const settle = (ms = 0) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))));

async function send(command: string, args: Record<string, unknown> = {}) {
  const id = `c${++nextId}`;
  socket.onmessage!({ data: JSON.stringify({ type: 'command', id, command, args }) });
  // Long enough for a save that fails three times over, which waits between tries.
  for (let i = 0; i < 200; i++) {
    const ack = socket.sent.find((message) => message.id === id);
    if (ack) return ack.answer!;
    await settle(10);
  }
  throw new Error(`no answer to ${command}`);
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await i18n.loadNamespaces('settings');
  FakeSocket.all = [];
  calls.length = 0;
  state = world();
  conflictOpen = false;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Harness />));
  act(() => setAssistantControl(true));
  await settle();
  socket = FakeSocket.all[0];
});

afterEach(async () => {
  act(() => root.unmount());
  assistantControlOn.set(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.doUnmock('@src/lib/supabase');
  vi.doUnmock('../../trackConflict');
  vi.resetModules();
});

describe('updating the code', () => {
  it('on the track playing: the undoable replacement, then the Update button', async () => {
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['replaceCode:new', 'Update']);
  });

  it('while stopped: the text changes, and no button makes a sound', async () => {
    state.playing = false;
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['replaceCode:new']);
  });

  it("with typing unsaved: the file manager's save, with no toast, before the text is replaced", async () => {
    state.unsaved = true;
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
    expect(calls).toEqual(['save:t1:false', 'replaceCode:new', 'Update']);
  });

  it('when that save fails: refused, and neither the editor nor the music is touched', async () => {
    state.unsaved = true;
    state.saveWorks = false;
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'save_failed' });
    expect(calls.filter((call) => !call.startsWith('save:'))).toEqual([]);
  });
});

describe('playing', () => {
  it('another track playing: the Update button, which is what uses the selected transition', async () => {
    state.playingTrack = 't2';
    expect(await send('play')).toMatchObject({ ok: true });
    expect(calls).toEqual(['Update']);
  });

  it('stopped: what Play does', async () => {
    state.playing = false;
    state.playingTrack = 't2';
    expect(await send('play')).toMatchObject({ ok: true });
    expect(calls).toEqual(['editor.evaluate']);
  });

  it('the same track already playing: nothing restarts', async () => {
    expect(await send('play')).toMatchObject({ ok: true });
    expect(calls).toEqual([]);
  });
});

describe('stopping', () => {
  it('while playing: the Stop button', async () => {
    expect(await send('stop')).toMatchObject({ ok: true });
    expect(calls).toEqual(['Stop']);
  });

  it('while stopped: nothing, as that button would start it', async () => {
    state.playing = false;
    expect(await send('stop')).toMatchObject({ ok: true });
    expect(calls).toEqual([]);
  });
});

describe('what the tab knows', () => {
  it('a transition the REPL announced refuses a command until it ends', async () => {
    window.dispatchEvent(new Event('track-transition-start'));
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toEqual({
      ok: false,
      code: 'transition_in_progress',
    });
    expect(await send('play')).toEqual({ ok: false, code: 'transition_in_progress' });
    expect(calls).toEqual([]);
    window.dispatchEvent(new Event('track-transition-end'));
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
  });

  it('the "changed elsewhere" message refuses a command until the user chooses', async () => {
    conflictOpen = true;
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toEqual({ ok: false, code: 'conflict_open' });
    expect(calls).toEqual([]);
    conflictOpen = false;
    expect(await send('update_code', { code: 'new', trackId: 't1' })).toMatchObject({ ok: true });
  });

  it('says what the track and tempo are', async () => {
    expect(await send('status')).toEqual({
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

describe('the short message in the tab', () => {
  it('says in words what happened, and a mistake or a refusal is a warning', async () => {
    const info = vi.spyOn(toastActions, 'info').mockImplementation(() => '' as never);
    const warning = vi.spyOn(toastActions, 'warning').mockImplementation(() => '' as never);
    await send('stop');
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).not.toMatch(/assistantControl|messages\./);
    expect(warning).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('track-transition-start'));
    await send('play');
    window.dispatchEvent(new Event('track-transition-end'));
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0][0]).not.toMatch(/assistantControl|messages\./);
  });
});
