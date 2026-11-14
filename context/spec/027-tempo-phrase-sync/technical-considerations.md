# Technical Specification: Tempo and Phrase Sync

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Claude (for the owner)

---

## 1. High-Level Technical Approach

Everything happens inside spec 017's `TrackTransitionController` (`packages/mixer`, fork-only) and the website's transition settings. There is no new audio node, no Supabase change and no Worker code.

- **Phrases.**
  - `transitionStart` takes the playing track's **phrase origin** and counts boundaries from it.
  - The phrase origin is `controller.origin`, the cycle where the track's cycle 0 sits (017), plus the scratch shift of the speakers deck (023). The shift is read when the switch begins, before `PatternOffset` drops it.
  - `TRANSITION_SNAPS` gains 16.
- **Tempo.**
  - `settings.glide` (boolean) becomes `settings.tempo ∈ {jump, glide, match, keep}`.
  - During a transition, `match` and `keep` hold the old tempo.
  - After `_finish`, a new **tempo hold** keeps working while the controller is otherwise idle:
    - `match`: a glide from the old tempo to the new one over `settings.length` cycles, stepped like 017's glide.
    - `keep`: the old tempo stays, and the track's own tempo is remembered.
  - While a hold exists, the controller routes `scheduler.setCps` through itself, as `_wrapSetCps` already does during a transition. That is how a hot swap's `setcps` cancels a glide or ends a keep, and how the hold is never fought over.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Controller — `packages/mixer/TrackTransitionController.mjs` (audio)

1. **Constants.**
   - `TRANSITION_SNAPS = [0, 1, 4, 8, 16]`.
   - New export: `TRANSITION_TEMPOS = ['jump', 'glide', 'match', 'keep']`.
   - `DEFAULT_TRANSITION_SETTINGS.tempo = 'jump'`. Drop `glide` from the defaults.
2. **`normalizeTransitionSettings`.**
   - A valid `s.tempo` wins.
   - Otherwise legacy `s.glide === true` gives `'glide'`.
   - Anything else gives `'jump'`.
   - The result has `tempo` and no `glide`. `evaluateNewTrack.OFF_AS_CUT` becomes `{ type: 'cut', snap: 0, tempo: 'jump', matchLoudness: false }`.
3. **`transitionStart(now, { type, snap }, origin = 0)`.**
   - With `size > 0`: `origin + (Math.floor((base − origin) / size + 1e-9) + 1) * size`, where `base = now + SAFETY_MARGIN`. This is strictly after `base`, as before. With `origin = 0` the result is identical to 017.
   - The beat grid used without a snap stays global, so the origin is ignored there. A beat-grid start is already "on the beat" for a track whose origin is a beat-grid value.
4. **Phrase origin.**
   - New constructor option `getTrackShift` (a function returning cycles; default `() => 0`; a throw or a non-finite value counts as 0 and logs a warning).
   - `_run` reads it into `sw.trackShift` before `repl.evaluate`, because `PatternOffset.editPattern` zeroes the shift once the switch is busy.
   - `_arm` calls `transitionStart(now, settings, this.origin + sw.trackShift)`.
5. **The tempo plan during a transition (`_applyTempo`).**
   - `jump`: unchanged (017 `glide: false`).
   - `glide`: unchanged (017 `glide: true`). Only overlapping types glide; Dip and Cut behave as `jump`.
   - `match` and `keep`: `_setCps(a, a.oldCps)` throughout. For Dip, the new tempo is no longer set at `T + L`. **Amended during implementation:** under match/keep, the Dip fade-up and the old-voice release are timed at the tempo that actually plays during the transition (the old one).
   - `_retarget` (a re-evaluate of the incoming track during the transition) still updates `a.newCps`. For `match`/`keep` that changes only the target after the transition.
6. **`_finish(a)`.**
   - `jump`/`glide`: `_setCps(a, a.newCps)`, as today.
   - `match`: leave the tempo at the old value, then `this._startTempoHold({ kind: 'glide', from: a.lastCps, to: a.newCps, start: a.end, L: a.settings.length })`.
   - `keep`: `this._startTempoHold({ kind: 'keep', cps: a.lastCps, ownCps: a.newCps })`.
   - `a.releaseTempo?.()` (the transition's setCps wrapper) is released **before** the hold installs its own wrapper.
7. **Tempo hold** (new methods):
   - `_startTempoHold(hold)`.
     - Store `this.tempoHold`.
     - Install the wrapper via `_wrapSetCps(onRequest)`. Its `apply` sets the clock directly.
     - Start ticking for `glide`.
   - `onRequest(cps)` (a `setcps`/`setcpm` from evaluated code, or anything else calling `scheduler.setCps`), with `cps = cps ?? DEFAULT_CPS`:
     - `glide`: end the hold and apply `cps` (spec 2.2: a hot swap's tempo applies at once).
     - `keep`: if `cps === hold.ownCps`, ignore it, because the track's code is unchanged. Otherwise end the hold and apply `cps`.
     - A request made while `capture.resetting` is set (onToggle(false)'s reset right after `stopped()`) is not special-cased, because `stopped()` has already ended the hold.
   - `_tick`.
     - For `glide`: `apply(glideCps(now, { T: start, L, oldCps: from, newCps: to }))`, only when the value changes.
     - When `now >= start + L`, apply `to` and end the hold.
     - Ticking continues while `this.active || this.metering || this.tempoHold?.kind === 'glide'`.
   - `_endTempoHold()`. Unwrap (restore the original `setCps`) and set `this.tempoHold = null`. It is idempotent.
   - **Who ends a hold:**
     - its own completion;
     - `onRequest`;
     - `_run` at the start of the next switch, **before** `oldCps` is read. The new switch then starts from the tempo the glide reached, or from the held set tempo.
     - `stopped()`;
     - `destroy()`.
   - **Same-track Update in Keep with code that sets no tempo:** no `setCps` call happens, so the hold simply stays (spec 2.2).
8. **`getState()`** additionally reports `tempoHold: 'glide' | 'keep' | null`, for tests and debugging. No UI uses it.

### 2.2 Scratch shift accessor — `website/src/repl/scratch/scratchRuntime.ts` (audio)

- Add `mainShiftCycles(): number` to the runtime. It returns `mainOffset?.total ?? 0`, which already includes a pending shift (`PatternOffset.total`).
- `website/src/repl/useReplContext.tsx` passes `getTrackShift: () => scratchRuntime.mainShiftCycles()` when it constructs `TrackTransitionController` (web wiring, one line).

### 2.3 Settings — `website/src/repl/transitionSettings.ts`, `website/src/settings.ts` (web)

- `TRANSITION_SNAP_OPTIONS = [0, 1, 4, 8, 16]`, and `transitionSnapLabelKey(16) → 'transitionSnapNext16'`.
- `TRANSITION_TEMPO_OPTIONS = ['jump', 'glide', 'match', 'keep'] as const`, plus a `TransitionTempo` type. `TransitionSettings.tempo` replaces `glide`.
- Raw settings key: `transitionTempo` (string), default `'jump'`. `parseTransitionSettings`:
  - takes a valid `transitionTempo`;
  - else `transitionGlide === true` or `'true'` gives `'glide'`;
  - else `'jump'`.
  - An invalid stored `transitionTempo` (e.g. `'fast'`) falls back the same way.
- The legacy `transitionGlide` key stays readable but is never written again. **Amended during implementation:** `persistentMap` writes every default into storage when the store mounts, so a default `transitionTempo: 'jump'` would hide a saved Tempo glide for good. `migrateLegacyTempoGlide` therefore runs at load, before the store mounts (next to the 017 migration). It writes `transitionTempo` (`'glide'` or `'jump'`) only when `transitionGlide` is stored and `transitionTempo` isn't, and it never writes `transitionGlide`. On the first save of a Tempo choice, `transitionTempo` is stored and wins from then on, so no explicit migration write is needed.
- Replace `isGlideDisabled(type)` with `isTempoOptionDisabled(type, tempo)`:
  - true for every option when `type === 'off'`;
  - true for `'glide'` when `type` is `dip` or `cut`.
- **Selected but disabled option.** If the stored tempo is `glide` and the type is Dip or Cut, the UI shows Glide during selected and greyed out, and the controller plays it as `jump` (017 behaviour).
- `settings.ts` mapping: `tempo: 'transitionTempo'`, and the default comes from `DEFAULT_TRANSITION.tempo`.

### 2.4 UI — `website/src/repl/components/panel/TransitionSettingsSection.tsx` (web)

- **Snap radiogroup:** 5 options, `grid-cols-3 sm:grid-cols-5`, with a one-line description under the label (`transitionSnapDescription`).
- **The Tempo glide checkbox** becomes a radiogroup named `transition-tempo`.
  - It has 4 options, each with its label and a description line, and reuses the section's existing radio component.
  - It is disabled as a whole when modifiers are disabled (Off). An individual option is disabled per `isTempoOptionDisabled`.
  - Data attribute `data-transition-tempo=""`.
- The compact layout uses the same component. The 016 rules apply:
  - targets at least 44 px;
  - no horizontal overflow at 390 px.
- `TransitionPicker` is unchanged.

### 2.5 i18n — all 9 locales (`website/src/i18n/locales/*/settings.json`, `website/src/i18n/types.ts`) (web)

- **Add:**
  - `transitionSnapNext16`, `transitionSnapDescription`;
  - `transitionTempo`;
  - `transitionTempoJump`, `transitionTempoGlide`, `transitionTempoMatch`, `transitionTempoKeep`;
  - `transitionTempoJumpDescription`, `transitionTempoGlideDescription`, `transitionTempoMatchDescription`, `transitionTempoKeepDescription`.
- **Remove:** `transitionGlide`, `transitionGlideDescription`, which are no longer used.
- English:
  - Snap description: "Phrases are counted from where the playing track began."
  - Jump: "The new tempo applies as soon as the transition begins."
  - Glide during: "The tempo moves from the old track's to the new one's during the transition."
  - Match, then glide: "Both play at the old tempo; then the new track moves to its own."
  - Keep set tempo: "The new track plays at the old track's tempo and stays there."
- `localeCompleteness` covers presence.

### 2.6 Docs

- `packages/mixer/README.md`: describe the transition settings with Snap 16, the phrase origin and `tempo`.
- `context/product/feature-map.md`: update the transition row (Bookkeeping).

---

## 3. Impact and Risk Analysis

- **Audio graph:** no nodes are created or disconnected. Tempo changes go through `Cyclist.setCps`, which keeps cycle continuity (017 §2), and are stepped `GLIDE_STEPS_PER_CYCLE` times per cycle.
- **Fighting over `scheduler.setCps`:**
  - Wrappers can nest: the transition's capture or hold, then the tempo hold. The rule is that at most one controller wrapper is installed at a time. `_run` ends the tempo hold before `_captureCps`, and `_finish` releases the transition's wrapper before installing the hold's.
  - A test asserts that `scheduler.setCps` is the original function after each of these:
    - a glide hold ends;
    - Stop;
    - destroy;
    - a switch during a hold.
- **Scratch (023):**
  - Grabs are blocked while `busy`, and a tempo hold does not count as busy. A scratch during the glide after a transition works on the speakers deck as usual.
  - Its motor/rate path does not call `scheduler.setCps`, so it can't end a hold. The Snap description's "track's start" includes the scratch shift (§2.1 step 4).
- **Set playlist (022):** Go calls `switchTo` with the global settings plus a per-item type and length, so it inherits Snap and Tempo. It needs a check that `SetTab`'s per-item settings object does not carry a stale `glide` only. `normalizeTransitionSettings` would still read legacy `glide`; the settings object is built from the global settings, so it carries `tempo`.
- **MCP (018):** `play` and `update_code` go through the same controller and settings. No change.
- **Upstream:** no `@strudel/core` or superdough change.
- **Saved data:** one new localStorage key, `transitionTempo`. The legacy key is read only. No Supabase change.
- **Worker size:** browser-only code, with no SSR page added.

---

## 4. Testing Strategy

- **`packages/mixer/test/`, with the existing controller harness (`TrackTransitionController*.test.mjs`, fake scheduler):**
  - `transitionStart` with an origin: the spec 2.1 examples, including the Dip origin and a fractional origin with Cut. `origin = 0` must give the same result as 017.
  - Phrase origin plus scratch shift via `getTrackShift`. A throwing `getTrackShift` must count as 0.
  - Normalize: the tempo values, legacy glide, garbage input.
  - Tempo plans, sampled per tick:
    - jump and glide must not change;
    - match holds, then glides over the Length (Cut with Length 8);
    - keep across two switches.
  - Hold rules:
    - in glide, a hot-swap `setcps` applies at once;
    - in keep, the same tempo is ignored and a different one applies;
    - a switch during a glide starts from the tempo reached;
    - Stop ends the hold, and the original `setCps` is restored.
- **`website/src/repl/__tests__/`:**
  - `parseTransitionSettings` and `isTempoOptionDisabled`.
  - `TransitionSettingsSection` on desktop and compact: 5 snaps, 4 tempo options, Glide during disabled for Dip and Cut, and a choice that persists.
  - The `getTrackShift` wiring (the source seam, as in 019 and 024).
- **Browser:**
  - The dev server with the settings panel: the Tempo group and Snap 16, on desktop and at 390 px.
  - `browser_evaluate` on the real controller: read `scheduler.cps` over time during a Match switch.
