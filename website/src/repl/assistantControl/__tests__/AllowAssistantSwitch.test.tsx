// @vitest-environment jsdom
/**
 * @spec: 018-strudel-mcp-server (functional 2.8)
 * The switch: off by default, one press off, nowhere to be seen where control isn't possible. Text comes
 * from the real locale files.
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
import en from '@src/i18n/locales/en/settings.json';

const resume = vi.fn(async () => {});
// Fresh modules: another file in this worker may already hold the switch with the real audio.
vi.resetModules();
vi.doMock('@strudel/webaudio', () => ({ getAudioContext: () => ({ resume }) }));

const { default: i18n } = await import('@src/i18n/i18n');
const { AllowAssistantSwitch, AssistantControlIndicator } = await import('../AllowAssistantSwitch');
const { assistantControlAvailable, assistantControlOn, setAssistantControl } = await import('../store');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | undefined;

const render = (element: React.ReactElement) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
};
const box = () => container!.querySelector<HTMLInputElement>('input[role="switch"]');

beforeEach(async () => {
  i18n.addResourceBundle('en', 'settings', en, true, true);
  await i18n.changeLanguage('en');
  resume.mockClear();
  assistantControlOn.set(false);
  assistantControlAvailable.set(true);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  assistantControlAvailable.set(false);
  assistantControlOn.set(false);
});

afterAll(() => {
  vi.doUnmock('@strudel/webaudio');
  vi.resetModules();
});

describe('the switch', () => {
  it('starts off in a new page, because nothing keeps it', async () => {
    vi.resetModules();
    const fresh = await import('../store');
    expect(fresh.assistantControlOn.get()).toBe(false);
    expect(fresh.assistantControlAvailable.get()).toBe(false);
  });

  it('is off by default, and says what it does', () => {
    render(<AllowAssistantSwitch />);
    expect(box()!.checked).toBe(false);
    expect(container!.textContent).toContain(en.assistantControl.allow);
    expect(container!.textContent).toContain(en.assistantControl.help);
  });

  it('turns on, and counts as the click that lets the page make sound', () => {
    render(<AllowAssistantSwitch />);
    act(() => box()!.click());
    expect(assistantControlOn.get()).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
  });

  it('is not there where control is not possible (embed, admin view)', () => {
    assistantControlAvailable.set(false);
    render(<AllowAssistantSwitch />);
    expect(box()).toBeNull();
  });

  it('can not be turned on from code either, where control is not possible', () => {
    assistantControlAvailable.set(false);
    setAssistantControl(true);
    expect(assistantControlOn.get()).toBe(false);
  });
});

describe('the indicator', () => {
  it('shows nothing while off', () => {
    render(<AssistantControlIndicator />);
    expect(container!.textContent).toBe('');
  });

  it('shows while on, and one press turns it off', () => {
    assistantControlOn.set(true);
    render(<AssistantControlIndicator />);
    expect(container!.textContent).toContain(en.assistantControl.indicator);
    act(() => container!.querySelector<HTMLButtonElement>('[data-testid="assistant-control-off"]')!.click());
    expect(assistantControlOn.get()).toBe(false);
    expect(container!.textContent).toBe('');
  });

  it('has a named button of a reachable size on a phone', () => {
    assistantControlOn.set(true);
    render(<AssistantControlIndicator compact />);
    const button = container!.querySelector<HTMLButtonElement>('[data-testid="assistant-control-off"]')!;
    expect(button.getAttribute('aria-label')).toBe(en.assistantControl.turnOff);
    expect(button.className).toContain('h-11');
  });
});
