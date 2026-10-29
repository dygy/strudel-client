// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FileTree } from '../FileTree';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Deleting (or creating) a track changes the track count. The sidebar used to key <FileTree>
// by that count, so React remounted it and every expanded folder collapsed.
const managerSource = readFileSync(
  resolve(process.cwd(), 'website/src/repl/components/sidebar/FileManagerRefactored.tsx'),
  'utf8',
);

const folders = { f1: { id: 'f1', name: 'test', path: 'test', parent: null, created: '' } } as any;
const track = (id: string, name: string) =>
  ({ id, name, code: '', created: '', modified: '', folder: 'f1', isMultitrack: false }) as any;

const noop = () => {};
const props = (tracks: Record<string, any>) =>
  ({
    tracks,
    folders,
    selectedTrack: null,
    activePattern: '',
    onTrackSelect: noop,
    onTrackInfo: noop,
    onTrackDownload: noop,
    onFolderDownload: noop,
    renamingTrack: null,
    renamingFolder: null,
    renameValue: '',
    setRenameValue: noop,
    onRenameFinish: noop,
    onRenameCancel: noop,
    emptySpaceContextItems: [],
    onSwitchStep: noop,
    renamingStep: null,
    onRenameStepFinish: noop,
    onRenameStepCancel: noop,
  }) as any;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = container = null;
});

describe('sidebar file tree keeps folders open when tracks change', () => {
  it('does not key <FileTree> by the track/folder counts (that remounts it)', () => {
    const fileTreeTag = managerSource.match(/<FileTree\b[\s\S]*?>/)?.[0] ?? '';
    expect(fileTreeTag).not.toBe('');
    expect(fileTreeTag).not.toMatch(/\bkey=/);
  });

  it('a folder stays expanded after a track inside it is deleted', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const both = { a: track('a', 'alpha'), b: track('b', 'beta') };

    act(() => root!.render(<FileTree {...props(both)} />));
    expect(container.textContent).not.toContain('alpha');

    const folderRow = [...container.querySelectorAll('*')].find(
      (el) => el.textContent?.trim() === 'test' && el.children.length === 0,
    ) as HTMLElement;
    act(() => folderRow.click());
    expect(container.textContent).toContain('alpha');

    act(() => root!.render(<FileTree {...props({ b: both.b })} />));
    expect(container.textContent).toContain('beta');
    expect(container.textContent).not.toContain('alpha');
  });
});
