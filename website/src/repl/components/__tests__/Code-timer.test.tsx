// @vitest-environment jsdom
/**
 * The editor's post-init check (a 100 ms timer that looks for a track or pending code) is cleared
 * when the editor unmounts. It used to outlive the component; with isolate:false and one worker it
 * then fired after jsdom's teardown, threw "window is not defined" in the next (node) test file
 * and left the vitest worker hanging (spec 016 push blocker).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Code } from '../Code';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const getActivePattern = vi.fn(() => '');

beforeEach(() => {
  vi.useFakeTimers();
  (window as any).getActivePattern = getActivePattern;
  getActivePattern.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
  delete (window as any).getActivePattern;
  vi.useRealTimers();
});

function renderCode() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const init = vi.fn();
  act(() => root!.render(<Code containerRef={{ current: null }} editorRef={{ current: null }} init={init} />));
  return init;
}

describe('Code post-init timer', () => {
  it('runs 100 ms after the editor is created', () => {
    const init = renderCode();
    expect(init).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(100));
    expect(getActivePattern).toHaveBeenCalledTimes(1);
  });

  it('is cleared when the editor unmounts before it fires', () => {
    renderCode();
    act(() => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(500));
    expect(getActivePattern).not.toHaveBeenCalled();
  });
});
