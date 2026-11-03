// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.2, 2.12)
 * @regression
 * "The section isn't shown to signed-out users or in the admin view."
 * The real settings tab. What's inside the section has its own tests, so it's stubbed here.
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

const auth = { isAuthenticated: true };

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
vi.doMock('../MixerSettings', () => ({ MixerSettings: () => null }));
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
    assistants: container.querySelector('[data-testid="assistants"]'),
    allowSwitch: container.querySelector('[data-testid="switch"]'),
  };
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  auth.isAuthenticated = true;
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

describe('the Connected assistants section', () => {
  it('is there, with the switch, for a signed-in user', () => {
    const { assistants, allowSwitch } = show();
    expect(assistants).not.toBeNull();
    expect(allowSwitch).not.toBeNull();
  });

  it('is not there signed out', () => {
    auth.isAuthenticated = false;
    const { assistants, allowSwitch } = show();
    expect(assistants).toBeNull();
    expect(allowSwitch).toBeNull();
  });

  it('is not there in the admin view, which is read-only', () => {
    const { assistants, allowSwitch } = show({ readOnly: true });
    expect(assistants).toBeNull();
    expect(allowSwitch).toBeNull();
  });
});
