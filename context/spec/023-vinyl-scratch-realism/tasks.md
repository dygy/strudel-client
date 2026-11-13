# Tasks — 023 vinyl scratch realism

Areas: **audio** (`packages/mixer/scratch`, `PreviewEngine`, the scratch UI and its wiring, which the feature map gives to audio with UI by web; done in one dispatch because the UI part is small and consumes the new deck API) covers slices 1–3. **tests** cover slice 4, and bookkeeping is slice 5. A core change, if one is needed, goes to `strudel-engine-engineer` first.

---

- [ ] **Slice 1: DSP with a continuous ring and physics**
  - [ ] 1.1 `scratchDsp.mjs` and `scratchProcessor.mjs`:
    - the ring is always written, and the read head follows the absolute record position;
    - forward movement reaches the newest sample;
    - brake on grab (~0.1 s) and spin-up on release (~0.4 s), on smooth curves;
    - lag tracking, snap targeting (beat = 0.25 cycle / cps), catch-up when `D = 0`;
    - `lagSettled` and `handOverReady`, then a ~20 ms coherent crossfade to live.

    (tech §2.1) **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 DSP unit tests from tech §4, positive and negative, proven red→green. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: The track moves**
  - [ ] 2.1 A per-deck pattern offset composed with the spec 017 origin in the main deck's `editPattern`, plus the same hook for the preview repl. The offset resets on stop and is kept on a same-track Update. (tech §2.2) **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 On `lagSettled`: apply the offset (`D·cps`), release that deck's stale voices, then signal `handOverReady` after the lookahead. Handle `D` smaller than the lookahead (tech §3). (tech §2.2–2.3) **[Agent: strudel-audio-engineer]**
  - [ ] 2.3 Decide and test what a grab does while a spec 017 transition is running. (tech §3) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: UI**
  - [ ] 3.1 The platter angle follows the real rate (motor and hand). (tech §2.3) **[Agent: strudel-audio-engineer]**
  - [ ] 3.2 A Snap to beat switch and hint in ScratchSection, persisted in `strudel-scratch-snap` (default on), with `scratchSnap` and `scratchSnapHint` in all 9 locales. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: Feature Testing**
  - [ ] 4.1 Map each acceptance criterion in functional-spec §2.1–2.5 to a test, or list it as browser-measured. Everything RED-validated. **[Agent: strudel-test-engineer]**

- [ ] **Slice 5: Bookkeeping**
  - [ ] 5.1 Feature map row, roadmap, spec Status Completed, and the memory note `vinyl-scratch-019` updated. **[Agent: main]**
