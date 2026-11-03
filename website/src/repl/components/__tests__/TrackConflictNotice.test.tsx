// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.5)
 * The notice: nothing without a conflict, the two buttons, and a discard in place of a version to
 * load when the track is gone. Text comes from the real locale files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window.localStorage;
  if (jsdomStorage && !globalThis.localStorage) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: jsdomStorage });
  }
});

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@src/i18n/i18n';
import en from '@src/i18n/locales/en/files.json';
import he from '@src/i18n/locales/he/files.json';
import { TrackConflictNotice } from '../TrackConflictNotice';
import { trackConflictStore, type ConflictState, type TrackConflictController } from '../../trackConflict';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const controller = {
  loadNewVersion: vi.fn(async () => {}),
  keepMine: vi.fn(async () => {}),
  discard: vi.fn(),
} as unknown as TrackConflictController;

const STATE: ConflictState = {
  trackId: 't1',
  trackName: 'Spiral',
  kind: 'changed',
  restored: false,
  busy: false,
  failed: false,
};
const q = (id: string) => container!.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

async function render(state: ConflictState | null, target: TrackConflictController | null = controller) {
  trackConflictStore.set(state);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<TrackConflictNotice controller={target} />));
  // useTranslation suspends until i18n is ready.
  for (let i = 0; i < 50 && state && !q('track-conflict-keep'); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  trackConflictStore.set(null);
});

describe('TrackConflictNotice', () => {
  it('shows nothing without a conflict', async () => {
    await render(null);
    expect(container!.textContent).toBe('');
  });

  it('shows the message and both buttons, as an alert', async () => {
    await render(STATE);
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
    expect(container!.textContent).toContain(en.trackConflict.message);
    expect(container!.textContent).toContain(en.trackConflict.detail);
    expect(q('track-conflict-load')!.textContent).toBe('Load the new version');
    expect(q('track-conflict-keep')!.textContent).toBe('Keep mine');
  });

  it('each button does its own thing', async () => {
    await render(STATE);
    await act(async () => q('track-conflict-load')!.click());
    expect(controller.loadNewVersion).toHaveBeenCalledOnce();
    expect(controller.keepMine).not.toHaveBeenCalled();
    await act(async () => q('track-conflict-keep')!.click());
    expect(controller.keepMine).toHaveBeenCalledOnce();
  });

  it('disables the buttons while one is working', async () => {
    await render({ ...STATE, busy: true });
    expect(q('track-conflict-load')!.disabled).toBe(true);
    expect(q('track-conflict-keep')!.disabled).toBe(true);
  });

  it('says so when a choice failed, and that the text is safe', async () => {
    await render({ ...STATE, failed: true });
    expect(container!.textContent).toContain(en.trackConflict.failed);
  });

  it('after a reload says the text is from earlier', async () => {
    await render({ ...STATE, restored: true });
    expect(container!.textContent).toContain(en.trackConflict.restoredDetail);
  });

  it('a deleted track has nothing to load: discard instead, and the name', async () => {
    await render({ ...STATE, kind: 'deleted' });
    expect(q('track-conflict-load')).toBeNull();
    expect(container!.textContent).toContain('"Spiral" no longer exists');
    await act(async () => q('track-conflict-discard')!.click());
    expect(controller.discard).toHaveBeenCalledOnce();
    expect(q('track-conflict-keep')).not.toBeNull();
  });

  it('is translated', async () => {
    await i18n.changeLanguage('he');
    await render(STATE);
    expect(container!.textContent).toContain(he.trackConflict.message);
    expect(q('track-conflict-keep')!.textContent).toBe(he.trackConflict.keepMine);
  });

  it('shows nothing with no controller (the read-only view)', async () => {
    trackConflictStore.set(STATE);
    await render(STATE, null);
    expect(q('track-conflict-keep')).toBeNull();
  });
});
