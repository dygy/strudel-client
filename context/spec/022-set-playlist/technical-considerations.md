# Technical Specification: Set Playlist

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Claude (for the owner, Dygy)

---

## 1. High-Level Technical Approach

This is a website-only feature. No `@strudel/*` package changes.

1. **Data.** A new Supabase table `set_lists` holds one row per set. The items are a JSONB array on the row: sets are small (tens of items), always loaded whole, and edited whole. RLS is by `auth.uid()`, like `tracks`. Four API routes under `/api/sets/*` act as the user via `userClient`, with the same compare-and-swap on `updated_at` as `/api/tracks/update`.
2. **Set player.** A pure state machine, `setPlayer.ts`, holds `{ setId, nowItemId, nextItemId, cuedItemId }` and decides what Cue, Go, cancel, select and end do. A React hook wires it to the REPL through a small **set bridge** that `useReplContext` provides. The bridge can:
   - open a track or step exactly as a library click does;
   - play code on the headphone preview;
   - push the editor to the speakers with one switch's transition override.
3. **REPL changes** in `useReplContext.tsx`:
   - `runUpdate` / `evaluateNewTrack` take an optional `{ transition, force }`.
     - `transition` overrides `type` and `length` for that switch. `snap`, `glide` and `matchLoudness` stay global.
     - `force` makes the switch a real switch even when the editor and the speakers hold the same track id (repeated items, two steps of one multitrack).
   - `evaluateNewTrack` reports whether the new code evaluated, so a failed Go doesn't advance the set.
   - While an item is cued, the editor's own evaluate (Ctrl+Enter, Alt+Enter) goes to the preview engine instead of the speakers.
4. **UI:**
   - a **Set** panel tab;
   - a **set bar** in the header and in the compact control bar;
   - "Add to set" in the library track and step menus;
   - the global Alt+Shift+N key.
5. **Where the position is kept.** The playing position is per browser, in localStorage. The set itself is in Supabase.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Data

**Table `public.set_lists`** (new):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, default `gen_random_uuid()` | |
| `user_id` | `uuid` not null → `auth.users(id)` on delete cascade | |
| `name` | `text` not null | 1–100 characters after trim; `CHECK (char_length(btrim(name)) between 1 and 100)` |
| `items` | `jsonb` not null default `'[]'` | `CHECK (jsonb_typeof(items) = 'array')` |
| `created_at`, `updated_at` | `timestamptz` default `now()` | `updated_at` set by the existing `update_updated_at_column()` trigger; it is the version used by compare-and-swap |

- **Constraints and index.** `UNIQUE (user_id, name)` gives the "A set with this name already exists" rule. There is also an index on `(user_id, updated_at desc)`.
- **RLS.** Enabled, with four policies mirroring `tracks` (`supabase_schema.sql:186-196`): SELECT/UPDATE/DELETE `USING (auth.uid() = user_id)`, INSERT `WITH CHECK (auth.uid() = user_id)`. UPDATE also gets `WITH CHECK (auth.uid() = user_id)`, so a row can't be handed to another user. `GRANT ALL ON public.set_lists TO authenticated`.

**Item shape** (one element of `items`):

```
{ id: string (nanoid, stable per item),
  trackId: string,                 // tracks.id
  stepId?: string, stepName?: string, stepIndex?: number,   // only for a multitrack step
  transition: null | { type: TransitionType, length: 1|2|4|8|16 } }   // null = Default
```

- **Step resolution.** Step ids aren't reliable (`multitrack.ts:10-16`; ids can repeat). An item resolves its step in this order:
  1. by `stepId`, when exactly one step has it;
  2. by `stepName` slug;
  3. by `stepIndex`, only when that step's name still matches.

  Otherwise it is **Missing**.
- **Server validation** (`website/src/lib/setLists.ts`, shared by the routes and the client):
  - at most 500 items;
  - `trackId` is a non-empty string ≤ 64 characters;
  - `transition` is null or `{type ∈ TRANSITION_TYPE_OPTIONS, length ∈ TRANSITION_LENGTH_OPTIONS}`;
  - unknown keys are dropped;
  - anything else gets 400 "Invalid data format".
- **Tracks aren't checked** against `tracks`. A deleted track simply shows Missing.

**Migration.**
- There is no `supabase/migrations/` directory yet (`architecture.md` §2). Create `supabase/migrations/20261113000000_set_lists.sql` (idempotent: `IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`) and mirror the table, policies, trigger and grant into `supabase_schema.sql`.
- Applying it to prod is a separate, approved step, done **before** the push: the new code calls `/api/sets/*` as soon as the Set tab opens.

### 2.2 API (Worker, `export const prerender = false`)

All routes use `getAuthenticatedUser` (`api/_auth.ts`), so a missing or expired session gets 401. They use `readJsonObject` (`lib/apiBody.ts`), so a bad body gets 400, and `userClient(accessToken)`, so RLS applies. The `version` on the wire is the row's `updated_at`.

| Route | Body | Answer |
|---|---|---|
| `GET /api/sets/list` | none | `200 { sets: [{ id, name, items, version }] }` ordered by `name` |
| `POST /api/sets/create` | `{ name? }` | `201 { set }`. A missing name becomes the first free "Set N" (the localized base comes from the client in `name`; the server only checks it). Name clash: `409 { error: 'name_taken' }` |
| `PUT /api/sets/update` | `{ id, name?, items?, expectedVersion }` | `200 { set }`. A single `UPDATE … WHERE id = ? AND updated_at = expectedVersion`. On a miss: `409 { error: 'version_conflict', current }` or `404`. Name clash: `409 { error: 'name_taken' }` (Postgres unique violation `23505`) |
| `DELETE /api/sets/delete` | `{ id }` | `200 { ok: true }` or `404` |

- Files: `website/src/pages/api/sets/{list,create,update,delete}.ts`.
- Client wrapper: `website/src/repl/sets/setsApi.ts`. It reuses the Bearer header logic of `lib/secureApi.ts` and serializes writes per set id, like `updateTrack`.

### 2.3 Client modules (`website/src/repl/sets/`)

| File | Responsibility |
|---|---|
| `setPlayer.ts` | Pure state machine. State `{ setId, nowItemId, nextItemId, cuedItemId, phase: 'idle' \| 'cueing' \| 'cued' \| 'going' }`. Actions: `start(set, fromItemId?)`, `press()` (Cue or Go), `cueLanded()` / `cueFailed()`, `goLanded()` / `goFailed()`, `cancelCue()`, `select(itemId)`, `end()`, `itemsChanged(set)` (reorder, remove, keep the position by item id). `press()` ignores calls while `cueing` or `going`. Next playable item: skips Missing ones and reports `skippedMissing`. Last item: `endOfSet`. |
| `resolveItem.ts` | Item plus the library's loaded tracks → `{ status: 'ok', track, stepIndex? } \| { status: 'missing' }`, using the step rule in §2.1. The display name comes from the live track, so renames and moves follow automatically (the id doesn't change: `api/tracks/update.ts`). |
| `setPosition.ts` | localStorage key `strudel-set-position` = `{ setId, nowItemId, nextItemId }`, written on every landed Cue or Go, select and end, and read on load. Every access is wrapped in try/catch, and a corrupt value counts as no position. `cuedItemId` isn't restored, because nothing plays after a reload. |
| `useSets.ts` | Loads the list when signed in, and keeps optimistic local edits. Saves are debounced (≤ 2 s) through `setsApi`, with retry and backoff plus the "Couldn't save the set — retrying" toast. A `version_conflict` adopts `current` and re-applies the pending edit once. |
| `useSetPlayer.ts` | Connects `setPlayer` to the **set bridge** (below) and to `useSets`. It also runs side effects: open, preview, push, toasts. |
| `setShortcut.ts` | `installSetShortcut(onPress)`: a capture-phase `document` keydown listener. It matches `event.code === 'KeyN' && altKey && shiftKey && !ctrlKey && !metaKey` (`event.key` differs on macOS Option). It calls `preventDefault()` and `stopPropagation()` so no character reaches CodeMirror, ignores `event.repeat`, and works in the editor (unlike scratch). Inert while signed out, read-only, or with no set playing. Installed once, like `installScratchShortcut` (`useReplContext.tsx:529`). |

### 2.4 The set bridge (REPL side, `useReplContext.tsx`)

`useReplContext` exposes `setBridge`, a stable object built with refs:

- **`openItem(track, stepIndex?)`**: opens it exactly like a library click.
  - A plain track goes through the registered `handleTrackSelect`, via `assistantControl/openTrack.ts` `libraryOpenTrack`. That saves the current track first, pushes the URL and runs `loadTrack`.
  - A step needs a new registration, `libraryOpenStep({ trackId, stepIndex })`, published by `FileManagerRefactored.tsx` next to the existing one (`:140-147`) and calling `switchToStep`. If the track isn't open yet, it calls `handleTrackSelect`, then `switchToStep`.
  - It resolves once the editor holds the new code.
- **`cue(code)`**: `previewEngine.evaluate(code)` and `setIsPreviewing(true)`. The speakers aren't touched. If the preview is already playing, `evaluate` hot-swaps it.
- **`go({ transition })`**: does what Update does while previewing (`:806-811`), plus `scratchHooks.previewStopping(engine)`, which that path currently skips. It then calls `runUpdate({ force: true, transition })`. It resolves to `'switched' | 'failed'`.
- **`isPreviewing` / `isPlaying`** are readable, and there is an `onPreviewStopped` subscription. Stopping the preview through its own button while an item is cued fires `cancelCue()`.

Changes inside `useReplContext.tsx` and `trackSwitch.ts`:

- **`trackSwitch.update({ …, force })`.** With `force && isPlaying`, the outcome is `'switch'` even if `editorTrackId === playingTrackId`. The in-flight repeat guard stays: a second Go for the same target while one runs is `'ignored'`.
- **`evaluateNewTrack(code, { restart, prepare, transition })`.**
  - Effective settings = `{ ...getTransitionSettings(), ...transition }`. The `switchPath` decision uses the **effective** type, so a Crossfade item works while the global type is Off, and a Cut item while the global is Crossfade.
  - When the controller is busy, the effective settings are passed explicitly, not `undefined`. A queued Go then keeps its item's transition (`_enqueue` preserves an explicit object, `TrackTransitionController.mjs:309-322`).
  - It returns `'ok' | 'failed'`, and `evaluateFailed` maps to `'failed'`. The instant path returns `'failed'` if the repl reports an evaluation error (`afterEval` didn't fire for this code).
- **Update while cued.** When `isPreviewing` and the set player is `cued`, `handleEvaluate` routes to the set player's Go. That way Update uses the item's transition and advances the set (spec §2.3).
- **Editor evaluate while cued.** The set player installs a temporary wrapper on the editor instance, the same technique as `trackSwitch.attachEditor`. While `phase === 'cued'`, `editor.evaluate()` sends `editor.code` to `previewEngine.evaluate`. The wrapper is removed on Go, cancel or end. Outside a cue, nothing changes.
  - **Divergence from today's preview:** with a plain (non-set) preview, Ctrl+Enter still goes to the speakers. That is out of scope here.
- **Recreated tracks.** `replaceTrackId(oldId, newId)` (`useSupabaseFileManager.ts:1939`) also calls `useSets.remapTrackId(oldId, newId)`. That rewrites matching items and saves, so a recreated track doesn't turn Missing.

### 2.5 UI components

| Where | What |
|---|---|
| `components/panel/SetTab.tsx` (new) | Set list (new, rename, delete with confirm), the open set's items with drag reorder (native HTML5 drag, as the file tree does), up/down/remove buttons, a per-item transition picker (Default + 8 types × 5 lengths, reusing the option lists from `transitionSettings.ts`), "Add track" (a searchable list built from the library's loaded tracks and steps), Play set / End set, and the Missing badge. Signed out: "Sign in to build a set". |
| `components/panel/Panel.tsx` | Adds the tab id `set` to `getTabNames` (`:259-275`) and the `renderTabContent` switch (`:344-363`). It is **omitted when `context.readOnly`** (admin view). |
| `components/set/SetBar.tsx` (new) | Now playing · Up next (or "End of set") plus one Cue/Go button, with a menu holding End set. It renders only while a set is playing. In `Header.tsx` it goes after `ScratchButton` (`:309`); in `compact/CompactControlBar.tsx` after `ScratchButton touch` (`:105`), as a `touch` variant. It uses logical Tailwind classes only (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`). |
| `sidebar/FileTree.tsx` | Adds "Add to set" to `getTrackContextItems` (`:459-530`) and `getStepContextItems` (`:603-630`), guarded by `!readOnly`. Note: the function builds `baseItems` but returns `items`, so the entry has to go into the array that is actually returned. No open set: a small chooser (existing sets plus "New set"). |
| `panel/ShortcutsTab.tsx` | A row for Alt+Shift+N, next to the scratch row (`:121-124`). |

### 2.6 i18n

- **Namespace.** Keys go into the existing `settings` namespace under a `setList` prefix. That avoids adding a namespace to `i18n.ts`'s `ns` list and to `types.ts` `Resources`.
- **Other keys:** `tabs.set`, `files.addToSet`, `shortcuts.setNext`.
- **All 9 locales:** `ar en es fr he ko ru sr`(Cyrillic) `zh`.
- **Tests.** `localeCompleteness.test.ts` covers completeness. A new `i18n/__tests__/setListKeys.test.ts` follows `transitionTranslations.test.ts`: every `setList*` key is translated (not identical to English, small allowlist), there is a negative case, and an RTL check that `SetTab.tsx` and `SetBar.tsx` use no physical left/right classes.

### 2.7 Runtime

- **Worker:** 4 small API routes. No new SSR pages, no new dependencies, no change to the worker's size class. The size is still reported in verify.
- **Browser:** everything else.
- **No new env vars or secrets.**

### 2.8 Audio graph

- **No new nodes.** Cue uses the existing `PreviewEngine` (its own `AudioContext`). Go uses the existing `TrackTransitionController` path, so the ramps, the `editPattern` origin, the `setcps` capture and voice release are all 017's.
- **New behaviour on the audio path:**
  - a per-switch override of `type` and `length`;
  - `force`, which turns a same-id hot-swap into a switch;
  - the preview stop now also releases a held scratch platter on the preview deck.

### 2.9 Upstream impact

None. `packages/*` is untouched. The editor-evaluate redirect wraps the instance in the website, as `trackSwitch.attachEditor` already does.

---

## 3. Impact and Risk Analysis

- **Lost work.** Cue opens a track through the same `handleTrackSelect` / `switchToStep` path as a click, which awaits `saveCurrentTrack(false)` before loading. No new save path is added. Risk: Cue pressed while the previous Cue's load is still in flight. Mitigation: `press()` is ignored while `cueing`. A test covers a double press and a track switch during a pending save.
- **Audio continuity.** Cue must not touch the speakers. A test asserts that the main repl gets no `evaluate` and no scheduler calls on Cue. The 017 invariants hold because Go goes through `runUpdate` → `trackSwitch.update` → `evaluateNewTrack`, never `repl.evaluate` directly.
- **Same-id switches.** `force` bypasses the hot-swap rule from memory `update-must-hot-swap`, **only** for set Go. A plain Update keeps today's rule. Tests cover both.
- **Ctrl+Enter while cued.** Without the redirect, an edit while cued would replace the speakers' track with no transition. The redirect is scoped to the cued phase and removed in a `finally` path.
- **A failed Go.** `evaluateNewTrack` must report the failure. Otherwise the set advances while the old track still plays. Covered by a test with a throwing pattern.
- **Saved data shape.** A new table only; nothing existing changes. The migration has to run on prod before deploy, or the Set tab shows the save-retry toast (404 from PostgREST: `relation does not exist`).
- **Worker size.** 4 routes of about 2 KB each; verify reports the size.
- **Admin view.** The tab is hidden on `readOnly`, and the routes act as the session user, so an admin never sees another user's sets.
- **Hotkey conflicts.** Alt+Shift+N isn't bound in CodeMirror (`codemirror.mjs:154-183`, `prettierExtension.mjs:257` uses Shift-Alt-f) or in the global handler. The capture phase plus `preventDefault` stops the macOS "˜" character.

---

## 4. Testing Strategy

Vitest, positive and negative pairs, each proven red then green:

- **`repl/sets/__tests__/setPlayer.test.ts`** covers Cue→Go advancing, Go without Cue impossible, press ignored while `cueing` or `going`, cancel keeping Up next, select cancelling a cue, skipping a Missing item with the flag, end of set, a failed Go not advancing, and reorder or remove keeping the position by id.
- **`resolveItem.test.ts`** covers a step resolved by id, by name, by index with the name check, and Missing; a renamed track keeps its item.
- **`setPosition.test.ts`** covers a round trip, a corrupt value, and a throwing localStorage.
- **`setShortcut.test.ts`** covers `KeyN`+Alt+Shift firing once, with `event.key === '˜'` (macOS), repeat ignored, Ctrl/Meta combos ignored, `preventDefault` called inside `.cm-editor`, and inert when disabled.
- **`trackSwitch` tests** cover `force` switching on the same id, a plain Update still hot-swapping, and a repeat while in flight ignored.
- **`setBridge` tests** (`useReplContext` level, with the mixer mocks from `packages/mixer/test/webAudioMock.mjs` where needed) cover:
  - the transition override reaching `controller.switchTo`, including Crossfade with the global type Off;
  - an explicit override while busy;
  - Cue not touching the main repl;
  - Update while cued counting as Go;
  - Ctrl+Enter while cued going to preview;
  - `evaluateFailed` mapping to `'failed'`.
- **API tests** (`pages/api/__tests__/sets.test.ts`) cover 401 before the body is read, 400 on a bad body or item, `user_id` coming from the session, a name clash giving 409, a version conflict giving 409 with `current`, and delete giving 404 on a foreign or missing id.
- **UI tests** cover `SetTab` (signed out, CRUD, reorder buttons, transition picker, readOnly hiding the tab), `SetBar` (labels, End of set, compact variant), and the FileTree "Add to set" entry present and absent in readOnly.
- **i18n:** `setListKeys.test.ts` (§2.6).
- **Browser check (verify).**
  - Using `pnpm dev`: play a 3-item set, Cue, then Go.
  - Measure with `browser_evaluate`: the main gain stays steady during Cue, gain sampled every 20 ms during Go, and node counts before and after 5 Gos.
  - Check the console, an RTL locale, and the compact viewport.
