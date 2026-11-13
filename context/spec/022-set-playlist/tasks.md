# Tasks — 022 set playlist

Areas:
- **web** (`website/`): the data layer, API, set player, REPL bridge, UI and i18n. These are slices 1–5. The REPL switch changes in `useReplContext.tsx` / `trackSwitch.ts` are website code, so they stay with web.
- **tests:** slice 6.
- **bookkeeping:** slice 7.

---

- [x] **Slice 1: Data and API**
  - [x] 1.1 Create `supabase/migrations/20261113000000_set_lists.sql`, idempotent. It holds the table, checks, unique `(user_id, name)`, the index, RLS with 4 policies (UPDATE has both USING and WITH CHECK), the `updated_at` trigger and the grant. Mirror all of it into `supabase_schema.sql`. (tech §2.1) **[Agent: strudel-web-engineer]**
  - [x] 1.2 `website/src/lib/setLists.ts`: item and set types, plus `validateSetName` and `sanitizeItems` (≤ 500 items, the `trackId` rule, the transition type/length lists from `repl/transitionSettings.ts`, unknown keys dropped). It also holds `nextFreeSetName(base, names)`. (tech §2.1) **[Agent: strudel-web-engineer]**
  - [x] 1.3 `website/src/pages/api/sets/{list,create,update,delete}.ts`. Use `_auth.ts`, `readJsonObject` and `userClient`; update is a compare-and-swap on `updated_at` (409 `version_conflict` with `current`, or 404); a name clash gives 409 `name_taken`. Unit tests in `pages/api/__tests__/sets.test.ts`. (tech §2.2) **[Agent: strudel-web-engineer]**
  - [x] 1.4 `website/src/repl/sets/setsApi.ts`: the client wrapper with the Bearer header and writes serialized per set. (tech §2.2) **[Agent: strudel-web-engineer]**

- [x] **Slice 2: Set player core (pure)**
  - [x] 2.1 `repl/sets/setPlayer.ts`: the state machine and actions from tech §2.3 (press, landed/failed, cancel, select, end, itemsChanged, skip Missing, end of set). **[Agent: strudel-web-engineer]**
  - [x] 2.2 `repl/sets/resolveItem.ts`: step resolution by id, then name slug, then index with a name check, else Missing. (tech §2.1, §2.3) **[Agent: strudel-web-engineer]**
  - [x] 2.3 `repl/sets/setPosition.ts`: localStorage `strudel-set-position`, every access in try/catch. (tech §2.3) **[Agent: strudel-web-engineer]**
  - [x] 2.4 `repl/sets/setShortcut.ts`: Alt+Shift+N by `event.code`, capture phase, `preventDefault`, repeat ignored, works in the editor, `enabled()` gate. (tech §2.3) **[Agent: strudel-web-engineer]**

- [x] **Slice 3: REPL bridge**
  - [x] 3.1 `repl/trackSwitch.ts`: the `force` option on `update`/`decide` (a switch on the same id while playing; the in-flight repeat guard is kept). (tech §2.4) **[Agent: strudel-web-engineer]**
  - [x] 3.2 `repl/useReplContext.tsx`:
    - `runUpdate` and `evaluateNewTrack` take `{ transition, force }`;
    - effective settings drive `switchPath`;
    - the explicit settings are passed while busy;
    - it returns `'ok' | 'failed'`.

    (tech §2.4) **[Agent: strudel-web-engineer]**
  - [x] 3.3 `useReplContext.tsx`: expose `setBridge` (`openItem`, `cue`, `go`, `isPreviewing`, `isPlaying`, `onPreviewStopped`):
    - `go` releases the preview scratch;
    - Update while cued routes to set Go;
    - recreated tracks are remapped via `useSets.remapTrackId`.

    (tech §2.4) **[Agent: strudel-web-engineer]**
  - [x] 3.4 `sidebar/FileManagerRefactored.tsx` + `assistantControl/openTrack.ts`: register `libraryOpenStep({ trackId, stepIndex })` next to `libraryOpenTrack`; not in readOnly. (tech §2.4) **[Agent: strudel-web-engineer]**
  - [x] 3.5 The editor-evaluate redirect while cued: wrap the instance and remove it in `finally` on Go, cancel or end. (tech §2.4) **[Agent: strudel-web-engineer]**
  - [x] 3.6 `repl/sets/useSets.ts` and `repl/sets/useSetPlayer.ts`: debounced saves with retry and the toast, conflict adoption, wiring to the bridge, the shortcut installed once. (tech §2.3) **[Agent: strudel-web-engineer]**

- [x] **Slice 4: UI**
  - [x] 4.1 `components/panel/SetTab.tsx`, added to `Panel.tsx` tabs; hidden when `readOnly`. It shows sign-in when signed out, set CRUD with a delete confirm, items with drag and up/down/remove, the transition picker (Default + type × length), "Add track" search, Play set / End set, and the Missing badge. (tech §2.5) **[Agent: strudel-web-engineer]**
  - [x] 4.2 `components/set/SetBar.tsx` in `Header.tsx` after `ScratchButton`, and a `touch` variant in `compact/CompactControlBar.tsx`. It shows Now · Up next / End of set, the Cue/Go button and an End set menu. Logical classes only. (tech §2.5) **[Agent: strudel-web-engineer]**
  - [x] 4.3 `sidebar/FileTree.tsx`: "Add to set" in the track and step menus (`!readOnly`, in the array that is actually returned), plus a chooser when no set is open. (tech §2.5) **[Agent: strudel-web-engineer]**
  - [x] 4.4 `panel/ShortcutsTab.tsx`: an Alt+Shift+N row. (tech §2.5) **[Agent: strudel-web-engineer]**
  - [x] 4.5 Toasts: "Couldn't save the set — retrying", "Skipped a missing track". (spec §2.2, §2.5) **[Agent: strudel-web-engineer]**

- [x] **Slice 5: i18n**
  - [x] 5.1 Keys `settings.setList*`, `tabs.set`, `files.addToSet`, `shortcuts.setNext` in all 9 locales (`sr` in Cyrillic). (tech §2.6) **[Agent: strudel-web-engineer]**

- [x] **Slice 6: Feature testing**
  - [x] 6.1 Review the slice 1–5 tests against every acceptance criterion in `functional-spec.md` §2. Fill the gaps with positive and negative pairs, each proven red→green:
    - `setPlayer`, `resolveItem`, `setPosition`, `setShortcut` (macOS `˜` key);
    - `trackSwitch` `force` versus plain Update;
    - bridge: override reaching `switchTo` (Crossfade with global Off; explicit while busy), Cue not touching the main repl, Update while cued = Go, Ctrl+Enter while cued → preview, failed Go not advancing;
    - API (401 before the body, 400, 409 ×2, 404);
    - UI (SetTab, SetBar, FileTree entry, readOnly hidden);
    - `i18n/__tests__/setListKeys.test.ts` with the RTL class check.

    Run the whole suite with `--maxWorkers=2`. (tech §4) **[Agent: strudel-test-engineer]**

- [ ] **Slice 7: Bookkeeping**
  - [ ] 7.1 A `context/product/feature-map.md` row for the set playlist. **[Agent: orchestrator]**
  - [ ] 7.2 `context/product/architecture.md`: `set_lists` in the data model, and the first migration file (suggest `/awos:architecture`; don't edit it by hand). **[Agent: orchestrator]**
  - [ ] 7.3 The roadmap: a Phase 6 section with this item ticked after prod verification. **[Agent: orchestrator]**
