# Tasks — 020 strong EQ control

Areas:
- **audio** (`packages/equalizer`; the EQ panel and compact EQ, which the feature map assigns to audio; i18n keys for the EQ): slices 1–4.
- **tests:** slice 5.
- **bookkeeping:** slice 6.

---

- [ ] **Slice 1: Audio chain with ±24 dB, cuts, output level, limiter, true bypass**
  - [ ] 1.1 `packages/equalizer/AudioEqualizer.ts`:
    - build the dry/wet graph from tech §2.1;
    - Butterworth 4th-order low cut and high cut, made of 2 biquads each;
    - `outputGain` and a limiter (DynamicsCompressor) in the wet path;
    - band gain clamp ±24 dB;
    - new `setLowCut`, `setHighCut`, `setOutputGain`, `getLimiterReduction`, with JSDoc;
    - every change glides; settings are stored always and applied only while on;
    - on/off crossfades wet/dry;
    - `getState`/`setState`/`getFrequencyResponse`/`destroy` cover the new nodes.

    (tech §2.1) **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 Extend `packages/mixer/test/webAudioMock.mjs` with biquad `type`/`frequency`, DynamicsCompressor (`reduction`, params), and whatever `setTargetAtTime` tracking the new unit tests need. Update the existing equalizer unit tests for the new clamp and the bypass. (tech §4) **[Agent: strudel-audio-engineer]**
  - [ ] 1.3 Unit tests: clamps, Off handling, the store-while-off rule, re-apply on enable, glide calls, `destroy` disconnecting every node. Positive and negative, proven red→green. (tech §4) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: Presets as full settings, 12 genre presets**
  - [ ] 2.1 `packages/equalizer/presets.ts`:
    - add `group`, `lowCut`, `highCut` and `outputGain` to the preset type;
    - the 22 existing presets become `group: 'profile'` with their gains unchanged;
    - add 12 genre presets (tech §2.2 keys), with values designed per genre.

    **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 `applyPreset` applies bands, cuts and output. A profile preset clears the cuts and sets output to 0. (tech §2.1) **[Agent: strudel-audio-engineer]**
  - [ ] 2.3 Loudness matching: a pure-math helper computes each preset's pink-noise energy against Flat. Set each genre `outputGain` so the result is within ±3 dB, and add a test that enforces it for every genre preset. (tech §2.2) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: Persistence**
  - [ ] 3.1 `packages/equalizer/persistence.ts`:
    - add the optional `lowCut`, `highCut` and `outputGain` fields;
    - the loader accepts band gain within ±24 and validates the new fields (a present but invalid field counts as damaged);
    - a missing field gets its default;
    - `applyEqualizerSettings` and `getDefaultSettings` include the new fields.

    Tests: an old save loads unchanged, a new save round-trips, damaged new fields fall back to flat. (tech §2.3) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: Panel, compact EQ, i18n**
  - [ ] 4.1 `panel/EqualizerUI.tsx`:
    - ±24 slider range and chart scale (6 dB grid);
    - Low cut and High cut toggles with log frequency sliders;
    - Output level slider;
    - Limiting indicator: rAF poll of the main EQ's `getLimiterReduction()`, stopped on unmount;
    - preset select with Genres/Profiles `<optgroup>`s;
    - every control drives both EQs and saves the new fields;
    - any manual change makes the preset `custom`.

    (tech §2.4) **[Agent: strudel-audio-engineer]**
  - [ ] 4.2 `panel/EqualizerCompact.tsx`: `EQ_GAIN_MIN/MAX` ±24, plus the cuts and output level in the compact layout, following spec 016 rules with ≥44 px targets. (tech §2.4) **[Agent: strudel-audio-engineer]**
  - [ ] 4.3 i18n: the new keys and the updated `equalizerRange` and `equalizerSubtitle` in all 9 `settings.json` files, plus `website/src/i18n/types.ts` if keys are typed there. (tech §2.5) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 5: Feature Testing**
  - [ ] 5.1 Panel tests:
    - the ±24 range;
    - cut and output controls reach the main and preview EQs;
    - the limiting indicator;
    - preset groups; a genre preset sets the cuts; editing afterwards shows Custom;
    - the compact layout has the cuts.

    **[Agent: strudel-test-engineer]**
  - [ ] 5.2 i18n completeness test: every new EQ key exists in all 9 locales. **[Agent: strudel-test-engineer]**
  - [ ] 5.3 Acceptance mapping: one test per testable criterion in functional-spec §2.1–2.7, citing the criterion. Manual or browser checks are listed in the flow log. **[Agent: strudel-test-engineer]**

- [ ] **Slice 6: Bookkeeping**
  - [ ] 6.1 `context/product/feature-map.md` EQ row: code paths and tests. **[Agent: main]**
  - [ ] 6.2 `context/product/roadmap.md`: add and tick the item; set the spec Status to Completed after prod verification. **[Agent: main]**
  - [ ] 6.3 Memory: update the ranges in `eq-off-must-be-silent` and add the traps found in this run. **[Agent: main]**
