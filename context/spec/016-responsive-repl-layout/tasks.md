# Tasks: Responsive REPL Layout for Phones, Tablets and Landscape

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

Every task must:
- gate new UI on `compact`, so the desktop JSX is unchanged;
- never remount the editor;
- leave the audio graph untouched;
- put new strings in all 9 locales;
- prove each test RED then GREEN (mktemp backups).

- [x] **Slice 1: Compact chrome — editor full width, bottom control bar, title bar with More**
  - [x] 1.1 `panelViewport.ts` / `panelLayout.ts`:
    - `overridesAfterLoad` also hides the files on a compact load, session-only.
    - Add `overridesAfterSelectTrack` / `closeFileManagerAfterSelect`.
    - Export `CONTROL_BAR_HEIGHT` (56).
    - Unit tests (tech §2.1). **[Agent: strudel-web-engineer]**
  - [x] 1.2 Extract the record and screen-record handlers from `Header.tsx` `RecordPopover` into `repl/components/recordActions.ts`; the desktop header keeps the same behaviour (tech §2.2). **[Agent: strudel-web-engineer]**
  - [x] 1.3 `compact/CompactControlBar.tsx`:
    - Buttons: Play/Stop, Update (with the `isDirty` glow), Library, Settings.
    - Each button 44×44 with an `aria-label`.
    - Bottom safe-area padding.
    - (tech §2.2) **[Agent: strudel-web-engineer]**
  - [x] 1.4 `compact/CompactTitleBar.tsx` + `compact/CompactMoreMenu.tsx`:
    - The title bar shows the track name.
    - The More menu holds record audio / screen (elapsed time, stop), preview, share and auth.
    - It closes on an outside `pointerdown` and on Escape.
    - RTL-logical classes. (tech §2.2) **[Agent: strudel-web-engineer]**
  - [x] 1.5 Wire it up:
    - `Header.tsx` renders the title bar when compact; the desktop branch is unchanged.
    - `ReplEditor.tsx` renders the control bar and the editor bottom padding when compact.
    - `#code` keeps a stable tree position. (tech §2.2) **[Agent: strudel-web-engineer]**
  - [x] 1.6 Keyboard handling:
    - Viewport meta `initial-scale=1, interactive-widget=resizes-content`.
    - A `visualViewport` → `--app-height` script in `HeadCommon.astro`.
    - Bottom `scrollMargins` for the editor, from website code only (tech §2.4). **[Agent: strudel-web-engineer]**
  - [x] 1.7 Render test `compact/__tests__/CompactLayout.test.tsx`:
    - Bar vs desktop header at 390×844 / 1440×900.
    - More menu items call the context handlers.
    - Rotation keeps the same editor DOM node.
    - (tech §4) **[Agent: strudel-web-engineer]**
  - [x] 1.8 Verify in Playwright at 390×844, 844×390 and 1440×900:
    - bar position and button sizes;
    - title bar plus control bar ≤ 25% of the height in landscape;
    - desktop before/after screenshots identical;
    - delete screenshots outside `docs/screenshots/`.
    **[Agent: strudel-web-engineer]**

- [x] **Slice 2: The library as a drawer**
  - [x] 2.1 `compact/LibraryDrawer.tsx`:
    - Overlay plus backdrop, the close button, swipe-to-close, RTL side.
    - `ResizableSidebar` is not used on compact.
    - (tech §2.3) **[Agent: strudel-web-engineer]**
  - [x] 2.2 Close on select:
    - `FileManagerRefactored` takes an optional `onAfterTrackSelect`, called from the `FileTree` row only for a single track.
    - Folders, multitrack expansion and steps keep the drawer open.
    - Save-before-switch is unchanged. (tech §2.3) **[Agent: strudel-web-engineer]**
  - [x] 2.3 Long press in `ui/WorkingContextMenu.tsx` (pointer, 500 ms, cancel when moved > 10px, suppress the following click). 44px hit area for the `BurgerMenuButton` on coarse pointers or compact (tech §2.3). **[Agent: strudel-web-engineer]**
  - [x] 2.4 Render tests:
    - The drawer is closed on a compact load and the persisted setting is unchanged.
    - It opens and closes via the button, the backdrop and the close button.
    - It closes after a track select; a folder or step keeps it open.
    - It is exclusive with settings.
    - Long press opens the menu; moving cancels it; right-click still works.
    - The read-only view offers no edit items.
    **[Agent: strudel-web-engineer]**
  - [x] 2.5 Verify in Playwright at 390×844 and 820×1180:
    - tap a track → the drawer closes and the code shows;
    - long press opens the menu;
    - the drawer comes from the end edge in `he`.
    **[Agent: strudel-web-engineer]**

- [x] **Slice 3: Mixer, EQ and preview on touch (UI only)**
  - [x] 3.1 `panel/EqualizerCompact.tsx`, rendered by `EqualizerUI.tsx` when compact:
    - The full-width curve canvas; pointer selects the nearest band.
    - Band chips 1–10.
    - Gain / frequency / Q sliders for the selected band: visible value, 44px hit area, `touch-action: none`.
    - The sliders call the same band setter as desktop. No audio API change; the EQ-off-silent rule holds.
    - (tech §2.5) **[Agent: strudel-audio-engineer]**
  - [x] 3.2 Compact touch sizing in `MixerSettings.tsx`, `AudioDeviceSelector.tsx` and `AudioEngineTargetSelector.tsx`: ranges at 44px with a visible value and `touch-action: none`; selects `min-h-11`; desktop classes unchanged (tech §2.5). **[Agent: strudel-audio-engineer]**
  - [x] 3.3 Render tests:
    - Tapping the canvas at a band's x selects it.
    - The sliders call the setter with clamped values.
    - The desktop grid shows on wide screens.
    **[Agent: strudel-audio-engineer]**
  - [x] 3.4 Verify in Playwright at 390×844:
    - the EQ curve has no horizontal scroll;
    - selecting a band and dragging changes the curve;
    - gain stays at 1 and there is no scheduler stop or start while toggling the sheets.
    **[Agent: strudel-audio-engineer]**

- [x] **Slice 4: Sign-in surfaces and i18n**
  - [x] 4.1 `LoginPage.tsx`: narrow padding, Google button `min-h-11 w-full`, no horizontal overflow at 390 (tech §2.6). **[Agent: strudel-web-engineer]**
  - [x] 4.2 New `common` keys (tech §2.7) in all 9 locales plus `CommonTranslations`. Test: every key exists in every locale and no value equals the English one outside `en`, except proper nouns. **[Agent: strudel-web-engineer]**

- [x] **Slice 5: Feature Testing & Regression**
  - [x] 5.1 Read the functional spec's acceptance criteria in full. Fill the gaps not covered by slices 1–4 with acceptance-level jsdom tests (unsaved edit survives drawer, sheet and rotation; admin read-only on compact; login at 390), RED-validated, annotated `@spec: 016-responsive-repl-layout`. **[Agent: strudel-test-engineer]**
  - [x] 5.2 Run the whole suite with default workers and with `--maxWorkers=1`; all green. **[Agent: strudel-test-engineer]**

- [x] **Slice 6: Bookkeeping**
  - [x] 6.1 `context/product/feature-map.md`: a row for the responsive layout (paths, spec 016, tests); update the settings-panel row to point at 016. **[Agent: orchestrator]**
  - [x] 6.2 The spec Status becomes Completed; flow-log entries; a memory note. No migration (no schema change). **[Agent: orchestrator]**
