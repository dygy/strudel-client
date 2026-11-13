// @vitest-environment jsdom
/**
 * @spec: 020-eq-strong-control (functional §2.7)
 * "When a signed-out user opens the EQ, then the wider range, the cuts and the genre presets are all
 * available." The EQ is a device setting: the real settings tab shows the mixer section (which
 * mounts the EQ panel) when signed out and in the admin read-only view, while the signed-in-only
 * assistants section is hidden there (proving the signed-out state took effect). The mixer section
 * is stubbed; the EQ inside it is covered by EqualizerAcceptance020.test.tsx.
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

const auth = { isAuthenticated: false };

// isolate:false shares the module cache across files: re-import the tab with these mocks.
vi.resetModules();
vi.doUnmock('../SettingsTab');
vi.doMock('@src/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.doMock('@src/repl/util', () => ({ isUdels: () => false, isIframe: () => false, confirmDialog: async () => true }));
vi.doMock('@strudel/codemirror', () => ({ themes: { strudelTheme: {} } }));
vi.doMock('@strudel/webaudio', () => ({
  DEFAULT_MAX_POLYPHONY: 128,
  setMaxPolyphony: () => {},
  setMultiChannelOrbits: () => {},
}));
vi.doMock('../AudioDeviceSelector', () => ({ AudioDeviceSelector: () => null }));
vi.doMock('../AudioEngineTargetSelector', () => ({ AudioEngineTargetSelector: () => null }));
vi.doMock('../SampleCacheSettings', () => ({ SampleCacheSettings: () => null }));
vi.doMock('../MixerSettings', () => ({ MixerSettings: () => <div data-testid="mixer-with-eq" /> }));
vi.doMock('../LanguageSelector', () => ({ LanguageSelector: () => null }));
vi.doMock('../ConnectedAssistants', () => ({ ConnectedAssistants: () => <div data-testid="assistants" /> }));
vi.doMock('../../../assistantControl/AllowAssistantSwitch', () => ({
  AllowAssistantSwitch: () => <div data-testid="switch" />,
}));

class FakeAudioContext {}

const { SettingsTab } = await import('../SettingsTab');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function show(props: { readOnly?: boolean } = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SettingsTab started={false} {...props} />));
  return {
    eq: container.querySelector('[data-testid="mixer-with-eq"]'),
    assistants: container.querySelector('[data-testid="assistants"]'),
  };
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  auth.isAuthenticated = false;
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  vi.unstubAllGlobals();
});
afterAll(() => {
  for (const path of [
    '@src/hooks/useAuth',
    '@src/repl/util',
    '@strudel/codemirror',
    '@strudel/webaudio',
    '../AudioDeviceSelector',
    '../AudioEngineTargetSelector',
    '../SampleCacheSettings',
    '../MixerSettings',
    '../LanguageSelector',
    '../ConnectedAssistants',
    '../../../assistantControl/AllowAssistantSwitch',
  ]) {
    vi.doUnmock(path);
  }
  vi.resetModules();
});

describe('the EQ is there for everyone (spec 020 §2.7)', () => {
  it('AC 2.7.1: signed out, the settings tab shows the mixer section with the EQ', () => {
    const { eq, assistants } = show();
    expect(eq).not.toBeNull();
    expect(assistants).toBeNull(); // negative control: this really is the signed-out tab
  });

  it('AC 2.7.1: in the admin read-only view the EQ is shown too', () => {
    auth.isAuthenticated = true;
    const { eq, assistants } = show({ readOnly: true });
    expect(eq).not.toBeNull();
    expect(assistants).toBeNull();
  });

  it('AC 2.7.1: signed in, the EQ is the same section (not a signed-in-only copy)', () => {
    auth.isAuthenticated = true;
    const { eq, assistants } = show();
    expect(eq).not.toBeNull();
    expect(assistants).not.toBeNull();
    expect(container!.querySelectorAll('[data-testid="mixer-with-eq"]')).toHaveLength(1);
  });
});
