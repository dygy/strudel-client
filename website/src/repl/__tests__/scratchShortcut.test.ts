// @vitest-environment jsdom
/**
 * @spec: 019-vinyl-scratch-control (2.4; tech §2.6)
 * Holding Alt+Shift+← pulls the record back and Alt+Shift+→ pushes it forwards; letting go of
 * the keys, or the window losing focus, lets go. While focus is in the code editor or a text
 * field the keys keep their usual meaning (macOS word selection) and nothing is scratched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installScratchShortcut, isTypingTarget } from '../scratch/scratchShortcut';

let calls: string[] = [];
let uninstall: (() => void) | null = null;
let cleanup: HTMLElement[] = [];

// The keys hold the record as the 'key' source (anything else would be a bug).
const target = {
  grab: (source: string) => calls.push(source === 'key' ? 'grab' : `grab@${source}`),
  setMotor: (rate: number, source: string) =>
    calls.push(source === 'key' ? `motor:${rate}` : `motor:${rate}@${source}`),
  release: (source: string) => calls.push(source === 'key' ? 'release' : `release@${source}`),
};

function key(
  type: 'keydown' | 'keyup',
  keyName: string,
  init: KeyboardEventInit = {},
  on: EventTarget = document.activeElement ?? document.body,
) {
  const event = new KeyboardEvent(type, {
    key: keyName,
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  on.dispatchEvent(event);
  return event;
}

function mount<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element);
  cleanup.push(element);
  return element;
}

beforeEach(() => {
  calls = [];
  uninstall = installScratchShortcut(target);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  (document.activeElement as HTMLElement | null)?.blur?.();
  cleanup.forEach((el) => el.remove());
  cleanup = [];
});

describe('scratch shortcut', () => {
  it('Alt+Shift+← grabs and pulls back, and keyup lets go', () => {
    const down = key('keydown', 'ArrowLeft');
    expect(down.defaultPrevented).toBe(true);
    expect(calls).toEqual(['grab', 'motor:-1']);
    key('keyup', 'ArrowLeft', { altKey: true, shiftKey: true });
    expect(calls).toEqual(['grab', 'motor:-1', 'release']);
  });

  it('Alt+Shift+→ pushes forwards; switching arrows while held changes direction without a second grab', () => {
    key('keydown', 'ArrowRight');
    key('keydown', 'ArrowLeft');
    expect(calls).toEqual(['grab', 'motor:1', 'motor:-1']);
  });

  it('auto-repeat is ignored: one grab per press', () => {
    key('keydown', 'ArrowLeft');
    const repeat = key('keydown', 'ArrowLeft', { repeat: true });
    key('keydown', 'ArrowLeft', { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(calls).toEqual(['grab', 'motor:-1']);
  });

  it('letting go of Alt or Shift first also lets go', () => {
    key('keydown', 'ArrowLeft');
    key('keyup', 'Shift', { shiftKey: false });
    expect(calls.at(-1)).toBe('release');
    calls = [];
    key('keydown', 'ArrowRight');
    key('keyup', 'Alt', { altKey: false });
    expect(calls).toEqual(['grab', 'motor:1', 'release']);
  });

  it('the window losing focus lets go (a key released outside never sticks)', () => {
    key('keydown', 'ArrowLeft');
    window.dispatchEvent(new Event('blur'));
    expect(calls).toEqual(['grab', 'motor:-1', 'release']);
    // Nothing is held any more: the late keyup does nothing.
    key('keyup', 'ArrowLeft');
    expect(calls).toEqual(['grab', 'motor:-1', 'release']);
  });

  it('negative: ignored while the code editor has focus (the editor selects as usual)', () => {
    const editor = mount(document.createElement('div'));
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.tabIndex = 0;
    editor.appendChild(content);
    content.focus();
    expect(document.activeElement).toBe(content);

    const down = key('keydown', 'ArrowLeft', {}, content);
    key('keyup', 'ArrowLeft', {}, content);
    expect(down.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });

  it('negative: ignored while an input or a textarea has focus', () => {
    for (const tag of ['input', 'textarea'] as const) {
      const field = mount(document.createElement(tag));
      field.focus();
      const down = key('keydown', 'ArrowRight', {}, field);
      expect(down.defaultPrevented).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('negative: other combinations are not the shortcut', () => {
    key('keydown', 'ArrowLeft', { shiftKey: false });
    key('keydown', 'ArrowLeft', { altKey: false });
    key('keydown', 'ArrowLeft', { ctrlKey: true });
    key('keydown', 'ArrowLeft', { metaKey: true });
    key('keydown', 'ArrowUp');
    expect(calls).toEqual([]);
  });

  it('uninstall removes the listeners and lets go of a held key', () => {
    key('keydown', 'ArrowLeft');
    uninstall?.();
    uninstall = null;
    expect(calls).toEqual(['grab', 'motor:-1', 'release']);
    key('keydown', 'ArrowLeft');
    expect(calls).toEqual(['grab', 'motor:-1', 'release']);
  });

  it('isTypingTarget: editor, fields and editable text, not buttons or the page', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const inside = document.createElement('span');
    editor.appendChild(inside);
    expect(isTypingTarget(inside)).toBe(true);
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
