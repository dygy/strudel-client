# Tasks — 017 track transition types

Sequencing: implementation starts only after spec 016 has landed on `main` and the tree is clean. 016 owns `MixerSettings.tsx`, `Header.tsx` and the locales.

Areas:
- **audio** (`packages/mixer`): slices 2–5;
- **engine** (`packages/core/repl.mjs`): slice 4.1, landing before 4.2;
- **web** (`website/`): slices 1, 2.4, 6.

---

- [x] **Slice 1: Choose a transition type in Mixer Settings (Off and Dip work as today)**
  - [x] 1.1 `website/src/settings.ts`:
    - add `transitionType`, `transitionLength`, `transitionSnap`, `transitionGlide` and `transitionMatchLoudness` with their defaults;
    - add a one-time migration from `localStorage['strudel-smooth-transitions']`: `enabled` maps to dip/off, seconds map to the nearest cycles at 2 s per cycle with ties rounding down, and the old key is removed afterwards.

    (tech §2.1, §2.5) **[Agent: strudel-web-engineer]**
  - [x] 1.2 `panel/MixerSettings.tsx`:
    - the toggle and seconds slider become a Transition radio group (8 options) with a per-option description;
    - add a Length segmented control (1/2/4/8/16), Snap to (off/1/4/8), Tempo glide and Match loudness;
    - greyed-out states: Length for Off/Cut, Glide for Dip/Cut/Off, and all modifiers for Off.

    (spec 2.1–2.3) **[Agent: strudel-web-engineer]**
  - [x] 1.3 Interim wiring in `useReplContext.tsx`: `evaluateNewTrack` reads the settings at switch time. Off takes the instant path. Every other type temporarily uses the existing `SmoothTransitionManager` as Dip, with `duration = L / cps`. This keeps the app runnable until slice 2. **[Agent: strudel-web-engineer]**
  - [x] 1.4 i18n: labels and descriptions for 8 types, Length, Snap, Glide and Match loudness in all 9 `settings.json` files plus `website/src/i18n/types.ts`. **[Agent: strudel-web-engineer]**
  - [x] 1.5 Tests:
    - migration cases: on→dip, off→off, absent, 4 s→2 cycles, 3 s tie→1 cycle;
    - the radio group renders and persists;
    - the greyed-out states;
    - every new key exists in every locale.

    **[Agent: strudel-web-engineer]**
  - [x] 1.6 Verify in Playwright on `pnpm dev`:
    - select each option, reload, and the selection persists;
    - seed the old key with `{enabled:true,duration:4}`, reload, and Dip / 2 cycles shows;
    - the console is clean;
    - take an `he` screenshot, then delete it.

    **[Agent: strudel-web-engineer]**

- [x] **Slice 2: Pattern-level switching: Cut, Crossfade, Dip, snapping, broken-track safety**
  - [x] 2.1 `packages/mixer/transitions/{buildTransition,envelopes}.mjs`:
    - a pure builder for Cut, Crossfade (equal power on `velocity`) and the Dip window;
    - old events dropped at `T+L` and truncated past it, with `clip: 1`;
    - `stripLocations` on the old pattern.

    (tech §2.3) **[Agent: strudel-audio-engineer]**
  - [x] 2.2 `packages/mixer/TrackTransitionController.mjs`:
    - `switchTo(code, settings)`;
    - the `editPattern` hook: armed means compute `T` from snap and margin and build; idle means `late(origin)`, or the identical object when `origin = 0`;
    - `setcps` capture during evaluate (instance wrapper);
    - failed evaluate → restore cps, emit `error{evaluateFailed}`, reject;
    - Dip's `destinationGain` ramps with cps-aware seconds and the new cps applied at silence;
    - the end at `T+L` (Dip `T+2L`) → `repl.setPattern(newPat)`, draw cleanup, then the queue (latest only, sticky restart);
    - `origin` resets on stop;
    - events: `track-transition-{waiting,start,end,error}`.

    Port every `SmoothTransitionManager` behaviour (tech §2.2, §2.6). **[Agent: strudel-audio-engineer]**
  - [x] 2.3 Delete `SmoothTransitionManager.mjs` and its test after porting its cases into `TrackTransitionController.test.mjs`. Update `packages/mixer/index.mjs` exports. **[Agent: strudel-audio-engineer]**
  - [x] 2.4 `useReplContext.tsx`:
    - create the controller in place of the manager;
    - pass `editPattern` to `StrudelMirror`;
    - route non-Off types to `controller.switchTo` with a settings snapshot;
    - `onToggle(false)` → `controller.stopped()`;
    - `smoothTransitionNotifier.ts` listens to `track-transition-error` and adds the "old track keeps playing" message in 9 locales.

    **[Agent: strudel-web-engineer]**
  - [x] 2.5 Unit tests:
    - `buildTransition.test.mjs` (Cut, Crossfade, Dip window, truncation, `clip`, stripped locations);
    - `TrackTransitionController.test.mjs` (`T` per snap value, Cut's minimum of 1, captured cps, failed-evaluate safety, the queue, the end swap, origin across a hot-swap, idle identity, Dip ramps never jump, `NeoCyclist`-shaped fake).

    Positive + negative pairs. **[Agent: strudel-audio-engineer]**
  - [x] 2.6 Verify in Playwright:
    - Crossfade: sample analyser RMS every 50 ms, with no zero gap and nothing from the old track after `T+L` (the old track uses a long pad);
    - Dip: `destinationGain` over time;
    - Snap 4: the switch starts at a multiple of 4 (`scheduler.now()`);
    - a broken new track: the old track keeps playing and the error shows;
    - node counts are stable over 10 switches.

    Delete the artifacts afterwards. **[Agent: strudel-audio-engineer]**

- [x] **Slice 3: Filter sweep, Bass swap, Echo-out**
  - [x] 3.1 Builder: Filter sweep (`hcutoff` up on the old track, `cutoff` opening on the new one, combined with user values by max/min). Bass swap: a midpoint step at 250 Hz, plus the old track's fade over the second half. Echo-out: old events from the switch press to `T` go to `ECHO_ORBIT = 15` with `delay 0.7`, the feedback is derived from L (capped at 0.85), and events `≥ T` are dropped (tech §2.3). **[Agent: strudel-audio-engineer]**
  - [x] 3.2 Tests: the cutoff envelopes are monotonic and respect user values; alias names (`lpf`/`hpf`) resolve to `cutoff`/`hcutoff`; the bass-swap step lands at `T+L/2`; echo events carry the orbit, delay and feedback; nothing old after `T`. **[Agent: strudel-audio-engineer]**
  - [x] 3.3 Verify in Playwright: for each type, RMS has no gap; Echo-out's tail RMS decays to the noise floor by `T+L`. Delete the artifacts afterwards. **[Agent: strudel-audio-engineer]**

- [x] **Slice 4: Layered intro**
  - [x] 4.1 `packages/core/repl.mjs` (additive, upstream divergence noted): `evaluate` sets `state.layers = [{id, pattern}]` from its `$:` list before `setPattern`; the list is empty without `$:`. Test in `packages/core/test/`. **[Agent: strudel-engine-engineer]**
  - [x] 4.2 Builder: layer `k` of `n` enters at `T + L·k/n` in `$:` order. It falls back to Crossfade when `n ≤ 1` or when `all()`/`each()` transforms are present. Tests cover 4 layers / 8 cycles giving entries at 0, 2, 4 and 6, plus the single-layer fallback. **[Agent: strudel-audio-engineer]**
  - [x] 4.3 Verify in Playwright with a 4-layer track: the onset counts per layer grow in steps. Delete the artifacts afterwards. **[Agent: strudel-audio-engineer]**

- [x] **Slice 5: Tempo glide and Match loudness**
  - [x] 5.1 Controller tempo plan: with glide on, about 16 linear `setCps` steps per cycle over `[T, T+L]`, overlapping types only; with glide off, `setCps(newCps)` at `T`. **[Agent: strudel-audio-engineer]**
  - [x] 5.2 `transitions/loudness.mjs`:
    - a lazily created AnalyserNode tapped from `destinationGain`;
    - old RMS over 2 s before `T`, new RMS over 1 cycle after the end;
    - the trim (clamped ±9 dB) is applied as a `velocity` multiplier through the origin wrapper, in 4 steps over 1 cycle, and reset on the next switch;
    - the analyser is disconnected on `destroy`.

    **[Agent: strudel-audio-engineer]**
  - [x] 5.3 Tests: glide from 120 to 140 BPM is monotonic and ends exactly on `newCps`; glide off sets `newCps` at `T`; Dip/Cut ignore glide; the trim math and clamp; reset on the next switch. **[Agent: strudel-audio-engineer]**
  - [x] 5.4 Verify in Playwright: `scheduler.cps` over time during a glide; with a quiet → loud switch, RMS 2 cycles after the end is within 3 dB of before. Delete the artifacts afterwards. **[Agent: strudel-audio-engineer]**

- [x] **Slice 6: Transition picker next to Update**
  - [x] 6.1 `components/TransitionPicker.tsx` (type + length, bound to the settings store) placed beside Update in `Header.tsx`, and wherever 016 puts Update on compact screens. Update shows a waiting state on `track-transition-waiting` until `start`. 9-locale strings. **[Agent: strudel-web-engineer]**
  - [x] 6.2 Tests: picker ↔ Mixer Settings sync both ways; a change mid-transition doesn't alter the running switch (the snapshot is taken at the start); the waiting state appears and clears. **[Agent: strudel-web-engineer]**
  - [x] 6.3 Verify in Playwright at desktop and 390×844: change the type while playing, with no gain change (`destinationGain` steady) and no scheduler restart; screenshots at both sizes plus `he`, deleted afterwards. **[Agent: strudel-web-engineer]**

- [x] **Slice 7: Feature Testing & Regression**
  > Verifies the whole feature end-to-end against functional-spec.md, run after all implementation slices are complete.
  - [x] Read functional-spec.md acceptance criteria in full. Generate acceptance-level tests that verify the entire feature as a whole — not individual slices. Cover applicable layers (unit for pure logic, integration for service interactions, e2e for user flows) based on the project's testing stack. Write tests with RED validation (must fail before implementation is confirmed done). Annotate each test with `@spec: 017-track-transition-types` and `@regression` if suitable for long-term regression. **[Agent: strudel-test-engineer]**
  - [x] Run all generated tests. All must pass. Fix any failures before proceeding. **[Agent: strudel-test-engineer]**

- [x] **Slice 8: Bookkeeping**
  - [x] 8.1 `context/product/feature-map.md`: update the "Smooth crossfade transitions" row (new paths, spec 017, tests). Drop `SmoothTransitionManager` from it. **[Agent: orchestrator]**
  - [x] 8.2 Roadmap item, spec Status set to Completed, flow-log entries, and a memory note (traps: `editPattern` runs on every `setPattern`; the origin offset; `setcps` capture). No migration (no schema change). **[Agent: orchestrator]**
