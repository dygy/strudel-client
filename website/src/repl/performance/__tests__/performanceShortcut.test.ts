// @vitest-environment jsdom
/**
 * @spec: 030-performance-mode (2.1 enter and leave; tech §2.4)
 * Alt+Shift+P fires once per press, by event.code (macOS Option gives '∏'), even in the code editor,
 * without typing a character; held keys and Ctrl/Cmd combos don't fire.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPerformanceShortcut, isPerformanceKey } from '../performanceShortcut';

let presses = 0;
let uninstall: (() => void) | null = null;
let editor: HTMLElement;
let content: HTMLElement;
let typed: string[] = [];

function keydown(init: KeyboardEventInit, on: EventTarget = content) {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyP',
    key: '∏',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  on.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  presses = 0;
  typed = [];
  editor = document.createElement('div');
  editor.className = 'cm-editor';
  content = document.createElement('div');
  content.className = 'cm-content';
  content.contentEditable = 'true';
  // Stands in for CodeMirror's own keydown handler: it would type the key.
  content.addEventListener('keydown', (event) => {
    if (!event.defaultPrevented) typed.push(event.key);
  });
  editor.appendChild(content);
  document.body.appendChild(editor);
  uninstall = installPerformanceShortcut(() => presses++);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  editor.remove();
});

describe('installPerformanceShortcut', () => {
  it('fires once for Alt+Shift+P in the editor, stops the event and types nothing', () => {
    const event = keydown({});
    expect(presses).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(typed).toEqual([]);
  });

  it('matches the physical key: the macOS "∏" and a plain "P" both count', () => {
    keydown({ key: '∏' });
    keydown({ key: 'P' });
    expect(presses).toBe(2);
  });

  it('ignores an auto-repeated keydown, but still keeps it out of the editor', () => {
    keydown({});
    const held = keydown({ repeat: true });
    expect(presses).toBe(1);
    expect(held.defaultPrevented).toBe(true);
    expect(typed).toEqual([]);
  });

  it('ignores Ctrl/Cmd variants, a missing modifier and other keys (left to the editor)', () => {
    keydown({ ctrlKey: true });
    keydown({ metaKey: true });
    keydown({ altKey: false });
    keydown({ shiftKey: false });
    keydown({ code: 'KeyN', key: 'N' });
    expect(presses).toBe(0);
    expect(typed.length).toBe(5);
  });

  it('uninstall removes it', () => {
    uninstall?.();
    uninstall = null;
    keydown({});
    expect(presses).toBe(0);
  });
});

describe('isPerformanceKey', () => {
  it('is Alt+Shift+KeyP only', () => {
    const base = { code: 'KeyP', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false };
    expect(isPerformanceKey(base)).toBe(true);
    expect(isPerformanceKey({ ...base, code: 'KeyO' })).toBe(false);
    expect(isPerformanceKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isPerformanceKey({ ...base, metaKey: true })).toBe(false);
  });
});
