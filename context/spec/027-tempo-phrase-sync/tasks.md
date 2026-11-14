# Tasks: Tempo and Phrase Sync (027)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

- [x] **Slice 1: Controller — phrases and tempo modes (audio)**
  - [x] 1.1 `packages/mixer/TrackTransitionController.mjs`:
    - `TRANSITION_SNAPS` gains 16;
    - add `TRANSITION_TEMPOS`;
    - `DEFAULT_TRANSITION_SETTINGS.tempo = 'jump'`;
    - `normalizeTransitionSettings` returns `tempo` (legacy `glide` → `'glide'`) and no `glide` (tech §2.1 steps 1–2).
    - Export `TRANSITION_TEMPOS` from `packages/mixer/index.mjs`.
    - **[Agent: strudel-audio-engineer]**
  - [x] 1.2 `transitionStart(now, settings, origin = 0)` counts snap boundaries from `origin`. Add the constructor option `getTrackShift`, read in `_run` before evaluate, so the phrase origin is `this.origin + sw.trackShift` (tech §2.1 steps 3–4). **[Agent: strudel-audio-engineer]**
  - [x] 1.3 `_applyTempo` and `_finish` handle the four modes, and Dip no longer sets the new tempo under match/keep (tech §2.1 steps 5–6). **[Agent: strudel-audio-engineer]**
  - [x] 1.4 Tempo hold:
    - `_startTempoHold`, `_endTempoHold`, the `onRequest` rules and ticking for the glide (tech §2.1 step 7);
    - every hold ends on `_run`, `stopped()` and `destroy()`;
    - at most one `setCps` wrapper is installed at a time;
    - `getState().tempoHold`.
    - **[Agent: strudel-audio-engineer]**
  - [x] 1.5 Unit tests in `packages/mixer/test/TrackTransitionController.test.mjs` for 1.1–1.4: positive and negative pairs, plus "`scheduler.setCps` is the original afterwards". **[Agent: strudel-audio-engineer]**
  - [x] 1.6 `packages/mixer/README.md`: transition settings (Snap 16, phrase origin, tempo). **[Agent: strudel-audio-engineer]**

- [x] **Slice 2: Scratch shift accessor (audio)**
  - [x] 2.1 `website/src/repl/scratch/scratchRuntime.ts`: `mainShiftCycles()` returns `mainOffset?.total ?? 0`. Add a test in the existing scratchRuntime tests. **[Agent: strudel-audio-engineer]**

- [x] **Slice 3: Settings, UI, wiring, i18n (web)**
  - [x] 3.1 `website/src/repl/transitionSettings.ts` (tech §2.3):
    - `TRANSITION_SNAP_OPTIONS` gains 16;
    - add `TRANSITION_TEMPO_OPTIONS` and `TransitionTempo`;
    - `TransitionSettings.tempo` replaces `glide`;
    - `parseTransitionSettings` reads `transitionTempo`, then legacy `transitionGlide`;
    - `isTempoOptionDisabled` replaces `isGlideDisabled`;
    - `transitionSnapLabelKey(16)`.
    - **[Agent: strudel-web-engineer]**
  - [x] 3.2 `website/src/settings.ts`: the `transitionTempo` key, its default and the mapping `tempo: 'transitionTempo'`. Legacy `transitionGlide` stays readable and is never written. **[Agent: strudel-web-engineer]**
  - [x] 3.3 `website/src/repl/evaluateNewTrack.ts`: `OFF_AS_CUT` gets `tempo: 'jump'` instead of `glide: false`. `website/src/types/strudel.d.ts`: the mixer settings type gets `tempo`. Fix any other `glide` reference (`SetTab.tsx` comment). **[Agent: strudel-web-engineer]**
  - [x] 3.4 `website/src/repl/components/panel/TransitionSettingsSection.tsx`: Snap with 5 options plus a description; the Tempo radiogroup with 4 options and descriptions, disabled per option; compact layout rules (016) (tech §2.4). **[Agent: strudel-web-engineer]**
  - [x] 3.5 `website/src/repl/useReplContext.tsx`: pass `getTrackShift: () => scratchRuntime.mainShiftCycles()` to `TrackTransitionController`. **[Agent: strudel-web-engineer]**
  - [x] 3.6 i18n: add the 11 keys and remove the 2 from tech §2.5, in all 9 `settings.json` files and `website/src/i18n/types.ts`. **[Agent: strudel-web-engineer]**
  - [x] 3.7 Update existing tests that use `glide` or `isGlideDisabled` (settings, section, evaluateNewTrack) so they cover the new API. **[Agent: strudel-web-engineer]**

- [x] **Slice 4: Feature Testing**
  - [x] 4.1 Map every acceptance criterion in functional-spec §2.1–2.3 to a test:
    - the controller acceptance tests in `packages/mixer/test/transitionAcceptance.test.mjs` (phrase examples, tempo tables per mode, hold rules sampled per tick, steps ≥ 16/cycle);
    - website tests for settings migration, the UI on desktop and compact, and the wiring.
    - RED-validated.
    - **[Agent: strudel-test-engineer]**

- [x] **Slice 5: Bookkeeping**
  - [x] 5.1 `context/product/feature-map.md` transition row; roadmap tick; spec Status Completed; memory (after prod). **[Agent: main]**
