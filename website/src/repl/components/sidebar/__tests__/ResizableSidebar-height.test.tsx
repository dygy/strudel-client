// @vitest-environment jsdom
/**
 * Regression (2026-10-30, "the track list doesn't scroll when there are many tracks"): the
 * desktop sidebar root had no height, so it grew to the full tree, every `h-full` below it
 * resolved to the content height and the tree's `overflow-auto` scroller never got smaller than
 * its content — the outer `overflow-hidden` just clipped the rest. jsdom does no layout, so this
 * pins the class that gives the chain its height (checked in a real browser: 452px of 2256px,
 * scrollTop 400 with it; no scrolling without it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@src/i18n', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (k: string) => k }) }));

import { ResizableSidebar } from '../ResizableSidebar';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('ResizableSidebar', () => {
  it('fills the height of its slot so the file tree inside can scroll', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <ResizableSidebar>
          <div data-child="" />
        </ResizableSidebar>,
      ),
    );

    const sidebar = host.querySelector('[data-child]')!.parentElement!;
    expect(sidebar.className.split(/\s+/)).toContain('h-full');
  });
});
