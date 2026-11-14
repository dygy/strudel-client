# Tasks — 025 scratch feel controls

Area: **audio** (`packages/mixer/scratch`, scratch runtime and UI, as in 023) owns slices 1–2. **Tests** own slice 3, and bookkeeping is slice 4.

---

- [ ] **Slice 1: Physics, DSP, deck**
  - [ ] 1.1 `scratchPhysics.mjs`: add the snap grid, the feel defaults and ranges, `sanitizeScratchFeel`, and a planner parameterised by spin-up with stretch bounds 0.5×–2×. The defaults must reproduce 023 exactly. (tech §2.1) **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 `scratchDsp.mjs`, `scratchProcessor.mjs`, `ScratchDeck.mjs`: add the `feel` message, `spinUpSeconds` on release, `setFeel`, `snapGrid`, and the deprecated boolean alias. A running brake or plan keeps its length. (tech §2.2) **[Agent: strudel-audio-engineer]**
  - [ ] 1.3 Unit tests from tech §4, physics and DSP, proven red→green. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: Runtime and UI**
  - [ ] 2.1 `scratchRuntime.ts`: add `snapGrid` and `feel` to the store, migrate the stored values, use the new `strudel-scratch-feel` key, and propagate to both decks, including the lazy preview deck. (tech §2.3) **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 `ScratchSection.tsx`: add the Snap select, the Brake and Spin-up sliders with readouts, and Reset. Make it work in compact layout. The platter animation follows feel. (tech §2.3) **[Agent: strudel-audio-engineer]**
  - [ ] 2.3 i18n: 9 keys in all 9 locales. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: Feature Testing**
  - [ ] 3.1 Map each acceptance criterion in functional-spec §2.1–2.3 to a test, or list it as browser-measured. Everything is RED-validated. **[Agent: strudel-test-engineer]**

- [ ] **Slice 4: Bookkeeping**
  - [ ] 4.1 Feature map row, roadmap, spec Status Completed, memory `vinyl-scratch-019`. **[Agent: main]**
