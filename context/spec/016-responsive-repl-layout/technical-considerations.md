# Technical Specification: Responsive REPL Layout for Phones, Tablets and Landscape

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Approved (orchestrator gate; the owner delegated the decisions, 2026-10-30)
- **Author(s):** Claude (orchestrator), from an Explore pass over `website/src`

---

## 1. High-Level Technical Approach

Everything is client-side React and CSS in `website/`. There is no Worker, API, Supabase or audio-graph change.

The compact rule and the session-only layout state already exist from 8c24935: `website/src/repl/components/panel/panelViewport.ts` and `panelLayout.ts`. This feature extends them and branches the REPL chrome on `compact`:

- **Compact:** a thin **title bar**, a **bottom control bar**, the library as an **overlay drawer**, and the settings sheet (already shipped).
- **Wide:** the current tree. The desktop JSX stays as it is, and every new UI renders only when `compact` is true.

The editor DOM node (`#code` inside `ReplEditor`) must keep the same React position in both layouts. Switching layouts (rotation, resize) must never remount CodeMirror, because a remount would drop editor state and could disturb evaluation. The drawer, the bars and the sheet are siblings or overlays around it.

## 2. Proposed Solution & Implementation Plan

### 2.1 Layout state (extend existing modules)

| File | Change |
|---|---|
| `repl/components/panel/panelViewport.ts` | `overridesAfterLoad` also sets `filesHidden` on a compact load (spec 2.2: library closed on first compact open). Add `overridesAfterSelectTrack(compact)`, which hides the files on compact. Export the compact rule unchanged (768 / 500 / 1024 / portrait). |
| `repl/components/panel/panelLayout.ts` | Add `closeFileManagerAfterSelect(compact)` (session-only; the persisted `isFileManagerOpen` is untouched) and `controlBarHeight` (constant, 56). `usePanelLayout()` keeps its contract and adds `compact` to its consumers. |

All compact-only hides stay session-only, as in 8c24935, so a phone visit never changes a desktop tab's saved layout.

### 2.2 Compact chrome — new components

| File | Responsibility |
|---|---|
| `repl/components/compact/CompactTitleBar.tsx` | Height 44: the logo, the current track's name (truncated), and a **More** button (44×44) that opens `CompactMoreMenu`. Mirrored in RTL (logical `start`/`end` classes). |
| `repl/components/compact/CompactMoreMenu.tsx` | A popover or sheet listing record audio / record screen (with elapsed time and stop), preview (when `context.mixer` exists), share (`context.handleShare`) and the auth/profile entry. It reuses the `RecordPopover` handlers from `Header.tsx` (extract them to `repl/components/recordActions.ts` so both headers call one place). Closes on an outside `pointerdown` (not `mousedown`) and on Escape. |
| `repl/components/compact/CompactControlBar.tsx` | Fixed to the bottom of the REPL column, height 56, `padding-bottom: env(safe-area-inset-bottom)`. Holds Play/Stop (`context.handleTogglePlay`), Update (`context.handleEvaluate`, with the `isDirty` glow), Library (`toggleFileManager`) and Settings (`openPanel` / `closePanel`). Every button is at least 44×44 with an `aria-label`. |
| `repl/components/Header.tsx` | When `compact`, render `CompactTitleBar` instead of the desktop header. The desktop branch is byte-for-byte the same JSX. |
| `repl/components/ReplEditor.tsx` | When `compact`: render the sidebar as a drawer (2.3) instead of the inline flex column; render `CompactControlBar` after the row; give the editor `padding-bottom` equal to the bar height. The `#code` container keeps its place in the tree. |

### 2.3 Library drawer

- On compact, `ReplEditor` wraps the existing `FileManagerRefactored`, unchanged inside, in `repl/components/compact/LibraryDrawer.tsx`:
  - `absolute inset-y-0 start-0 w-[min(85vw,360px)] z-[15]`, with a backdrop `inset-0 z-[14] bg-black/40` behind it.
  - A transform slide of 200 ms, disabled under `prefers-reduced-motion`.
  - A close button (44×44, `data-library-close`).
  - A tap on the backdrop closes it. A pointer swipe of more than 60px towards the drawer's edge (pointer events, `touch-action: pan-y` on the drawer) closes it.
  - `ResizableSidebar` is not used on compact.
- **Close on select:** `FileManagerRefactored` gets an optional `onAfterTrackSelect` prop, which `LibraryDrawer` passes. It is called from the `FileTree` row handler **only for a single (non-multitrack) track**. Expanding a multitrack, choosing a step and toggling a folder keep the drawer open (spec 2.2). The save-before-switch path in `useFileManagerOperations.handleTrackSelect` is untouched; the drawer closes after that handler is invoked.
- **Long press:** `ui/WorkingContextMenu.tsx` gains pointer-based long press. `pointerdown` on a touch or pen pointer starts a 500 ms timer; movement over 10px or `pointerup` cancels it. When it fires, it opens the existing menu at the pointer position and suppresses the following click. Mouse right-click is unchanged.
- **Burger "⋮" size:** `ui/BurgerMenuButton.tsx` renders a 44×44 hit area when `(pointer: coarse)` or compact; the icon size is unchanged. The desktop mouse size is unchanged.
- **Read-only:** the existing `readOnly` gating already removes the edit items, so long press shows only the read-only items.
- **Exclusivity:** this already exists through `panelLayout` (opening one hides the other, session-only).

### 2.4 On-screen keyboard

- `components/HeadCommon.astro` viewport meta becomes `width=device-width, initial-scale=1, interactive-widget=resizes-content`.
  - This is standard and harmless on desktop.
  - It makes Android Chrome resize the layout viewport when the keyboard opens.
- iOS Safari ignores `interactive-widget`. A small client script in the same file updates `--app-height` from `window.visualViewport.height` on visualViewport `resize` and `scroll`, falling back to `innerHeight` as today. The REPL root already uses `h-app-height`, so the control bar ends up directly above the keyboard.
- The editor keeps the cursor line visible above the bar with CodeMirror `EditorView.scrollMargins` (bottom = bar height + 8). Today `#code .cm-content` has `padding-bottom: 50vh`, which already gives scroll room.
  - Adding the margin is a website-side extension passed through the existing editor setup. It is **not** a change to `packages/codemirror`. If the setup isn't reachable from website code, report it rather than editing the upstream package.

### 2.5 Mixer, EQ, preview on touch (UI only)

- **`repl/components/panel/EqualizerUI.tsx`:** on compact, render `EqualizerCompact` (new, same folder) instead of the 10-column band grid.
  - The existing curve `<canvas>` stays full width.
  - `pointerdown` / `pointermove` on the canvas selects the band nearest the pointer's x position, using the same frequency-to-x mapping the curve already draws with.
  - A band chip row (1–10, 44px each, horizontal scroll) also selects a band.
  - The selected band shows three range inputs (gain −12…+12 dB step 0.5, frequency, Q), each with a visible value, a 44px-tall hit area and `touch-action: none` so dragging doesn't scroll the sheet.
  - They call the **same** setter the desktop band input calls. That means no new audio API, and the clamps and the "EQ off stays silent" rule (memory: eq-off-must-be-silent) still hold.
  - The on/off switch and the preset select stay, with a 44px hit area.
- **`MixerSettings.tsx`, `AudioDeviceSelector.tsx`, `AudioEngineTargetSelector.tsx`:** on compact, the range input gets a 44px-tall hit area, `touch-action: none` and a visible value; the selects get `min-h-11`. Desktop classes are unchanged.
- No audio node is created, connected, disconnected or ramped by this work.

### 2.6 Sign-in surfaces

- `components/LoginPage.tsx`: on narrow screens, padding `p-4` instead of `p-8`; the Google button gets `min-h-11 w-full`; there is no horizontal overflow at 390px.
- The sign-in prompt in `sidebar/FileManagerRefactored.tsx:130-148` is unchanged. It renders inside the drawer.

### 2.7 i18n

- New keys go in `common.json` × 9 locales, and in `CommonTranslations` in `i18n/types.ts`:
  - `more`, `library`, `openLibrary`, `closeLibrary`, `settings` (if not present), `recordAudio`, `recordScreen`, `stopRecording`, `share`, `preview`, `eqBand` (with `{{n}}`), `gain`, `frequency`, `width`.
- These are used only by the compact components. The desktop header stays hard-coded English, as before; translating it would change the desktop, which is out of scope.

## 3. Impact and Risk Analysis

- **System dependencies:** the 8c24935 panel modules, `FileManagerRefactored` / `FileTree` / `useFileManagerOperations` (selection and save-before-switch), `WorkingContextMenu`, `BurgerMenuButton`, `EqualizerUI` (band setter), `HeadCommon.astro` (every page).
- **Runtime:** browser only. There are no new SSR pages and no env vars or secrets. The Worker bundle grows only by the client chunks served as assets, so the 3 MiB script limit isn't touched (report the `_worker.js` size anyway).
- **Data:** none. There are no schema changes and no new persisted settings (all compact state is session-only).
- **Audio graph:** none. **Audio continuity risk:** a layout switch remounting the editor or the `Repl` tree. Mitigation: a stable `#code` position, plus a render test that rotates the viewport and asserts the editor DOM node is the same object.
- **Upstream impact:** none. `packages/*` are untouched.

| Risk | Mitigation |
|---|---|
| Lost edits when the drawer opens or closes, or on rotation | The editor is never remounted (test above). The drawer doesn't touch editor state. Save-before-switch is unchanged. Covered by a render test plus a Playwright check. |
| Long press fires during a scroll of the tree | Cancel on movement over 10px. Use pointer events, not touch-only. |
| A swipe-close fights vertical scrolling of the tree | Only a horizontal delta over 60px with \|dx\| > \|dy\| closes it. |
| `interactive-widget=resizes-content` changes desktop layout | It has no effect on desktop browsers. Verified at 1440×900 against before-screenshots. |
| The visualViewport script runs on every page | Cheap, passive listener, same variable as today. |
| Desktop regression | Every new UI is gated on `compact`. Before and after screenshots at 1440×900; existing desktop render tests stay green. |
| RTL | Logical classes (`start`/`end`, `ps`/`pe`). The drawer comes from the end in `he` and `ar`. Playwright check in `he`. |

## 4. Testing Strategy

- **jsdom render tests** (pattern: `panel/__tests__/Panel-compact.test.tsx`: localStorage shim, `@src/repl/util` mock, `createRoot` + `act`, `setViewport`):
  - `repl/components/compact/__tests__/CompactLayout.test.tsx`:
    - at 390×844 the control bar renders 4 buttons (each with `min-h-11`/`min-w-11` classes and an `aria-label`) and the desktop header does not render;
    - at 1440×900 the opposite holds;
    - the More menu lists record, share and preview, and clicking an item calls the same context handler;
    - rotating 390×844 → 844×390 → 1440×900 keeps the same editor DOM node.
  - `LibraryDrawer` tests:
    - closed on a compact load even when `isFileManagerOpen` is true, and the persisted value is unchanged;
    - opens and closes via the button, the backdrop and the close button;
    - selecting a single track calls `onAfterTrackSelect` and closes it, while a folder toggle or a step keeps it open;
    - opening settings closes it, and vice versa.
  - `WorkingContextMenu` long press:
    - a pointer of type touch held 500 ms opens the menu;
    - moving 15px cancels it;
    - a mouse right-click still opens it.
  - `EqualizerCompact`: tapping the canvas at a band's x position selects it; the sliders call the band setter with clamped values; the desktop grid renders on wide screens.
  - i18n: every new key exists in all 9 `common.json` files and in `CommonTranslations`.
- **Playwright (verify step)** at 390×844, 844×390, 820×1180, 1180×820 and 1440×900:
  - the control bar's position and button sizes;
  - drawer flows: tap track → drawer closes and the code shows; long press → menu;
  - the title bar plus control bar is ≤ 25% of the height in landscape;
  - the EQ band selection;
  - the login page at 390;
  - a `he` mirror check;
  - desktop before and after screenshots.
  - Keyboard behaviour is checked by emulating a smaller `visualViewport`, since real on-screen keyboards can't be driven. The rest is listed as a manual check on a device.
- **Audio:** this layout doesn't touch the audio graph. Assert that the gain stays at 1 and there is no scheduler stop or start while toggling the drawer, sheet and More menu and resizing.
- **Suites:** format-check, lint, vitest (also `--maxWorkers=1`, as in CI), `pnpm build:cloudflare` with the worker size.
