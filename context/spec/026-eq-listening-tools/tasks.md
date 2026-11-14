# Tasks — 026 EQ listening tools

Area: **audio** (`packages/equalizer`, the EQ panel, `mainEqualizer`, recording; the feature map gives these to audio) owns slices 1–4. **Tests** own slice 5, and bookkeeping is slice 6.

---

- [ ] **Slice 1: Profiles loudness-matched**
  - [ ] 1.1 `presets.ts`: lower the output of acoustic, bassBoost, piano and rnb to within ±3 dB of Flat; the bands stay unchanged. Extend `presets.test.ts` to all 81 presets. Confirm a load never re-derives values from a preset key. (tech §2.4) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: A/B slots**
  - [ ] 2.1 `packages/equalizer/slots.ts`: load, save, migration, validation and copy, exported with JSDoc, plus unit tests. (tech §2.1) **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 `EqualizerUI.tsx` and `EqualizerCompact.tsx`: the A|B control and the Copy button. A switch applies to both EQs with the glide, edits go to the active slot, and spec 024 Apply goes to the active slot. (tech §2.1) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: Spectrum**
  - [ ] 3.1 `AudioEqualizer.createAnalyserTap()` (a fan-out, owned dispose), plus a test that the output connections are unchanged. (tech §2.2) **[Agent: strudel-audio-engineer]**
  - [ ] 3.2 The panel draws the spectrum behind the curve. It runs only while visible, on and playing, with the toggle persisted. Measure in the browser that the output is unaffected and that no frames run while stopped. (tech §2.2) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: Record as heard**
  - [ ] 4.1 `mainEqualizer.getMainEqualizerOutputTap()`, with tap selection in the audio and screen recording hooks (fallback to `destinationGain`), the persisted option and its UI checkbox. (tech §2.3) **[Agent: strudel-audio-engineer]**
  - [ ] 4.2 i18n: the new keys in all 9 locales. (tech §2.5) **[Agent: strudel-audio-engineer]**

- [ ] **Slice 5: Feature Testing**
  - [ ] 5.1 Map each acceptance criterion in functional-spec §2.1–2.5 to a test, or list it as browser-measured. Everything is RED-validated. **[Agent: strudel-test-engineer]**

- [ ] **Slice 6: Bookkeeping**
  - [ ] 6.1 Feature map row, roadmap, spec Status Completed, the spec 021 change log (AC 2.1.4 restored), and memory notes `eq-strong-control-020` / `eq-genre-presets-021`. **[Agent: main]**
