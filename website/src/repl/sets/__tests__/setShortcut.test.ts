// @vitest-environment jsdom
/**
 * @spec: 022-set-playlist (2.3 next key, 2.6; tech §2.3)
 * Alt+Shift+N fires once per press, by event.code (macOS Option gives '˜'), even in the code editor,
 * without typing a character; held keys and Ctrl/Cmd combos don't fire; inert while disabled.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSetShortcut, isSetNextKey } from '../setShortcut';

let presses = 0;
let enabled = true;
let uninstall: (() => void) | null = null;
let editor: HTMLElement;

function keydown(init: KeyboardEventInit, on: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', {
    code: 'KeyN',
    key: 'N',
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
  enabled = true;
  editor = document.createElement('div');
  editor.className = 'cm-editor';
  const content = document.createElement('div');
  content.className = 'cm-content';
  content.contentEditable = 'true';
  editor.appendChild(content);
  document.body.appendChild(editor);
  uninstall = installSetShortcut(() => presses++, { enabled: () => enabled });
});

afterEach(() => {
  uninstall?.();
  editor.remove();
});

describe('installSetShortcut', () => {
  it('fires once for Alt+Shift+N and stops the event', () => {
    const event = keydown({});
    expect(presses).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches by code: macOS Option+Shift+N gives key '˜'", () => {
    keydown({ key: '˜' });
    expect(presses).toBe(1);
  });

  it('works inside the code editor, and the editor never sees the key', () => {
    const content = editor.querySelector('.cm-content')!;
    let editorSaw = 0;
    content.addEventListener('keydown', () => editorSaw++);
    const event = keydown({ key: '˜' }, content);
    expect(presses).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(editorSaw).toBe(0);
  });

  it('ignores auto-repeat: a held key is one press', () => {
    keydown({});
    keydown({ repeat: true });
    keydown({ repeat: true });
    expect(presses).toBe(1);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['no Shift', { shiftKey: false }],
    ['no Alt', { altKey: false }],
    ['another key', { code: 'KeyM', key: 'M' }],
  ])('does nothing with %s', (_label, init) => {
    const event = keydown(init);
    expect(presses).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('is inert while disabled (signed out, read-only, no set playing) and leaves the event alone', () => {
    enabled = false;
    const event = keydown({});
    expect(presses).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('uninstalls', () => {
    uninstall?.();
    uninstall = null;
    keydown({});
    expect(presses).toBe(0);
  });
});

describe('isSetNextKey', () => {
  it('needs exactly Alt+Shift+KeyN', () => {
    const base = { code: 'KeyN', altKey: true, shiftKey: true, ctrlKey: false, metaKey: false };
    expect(isSetNextKey(base)).toBe(true);
    expect(isSetNextKey({ ...base, code: 'KeyB' })).toBe(false);
    expect(isSetNextKey({ ...base, ctrlKey: true })).toBe(false);
  });
});
