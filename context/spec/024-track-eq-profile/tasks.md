# Tasks — 024 track EQ profile

Areas: **audio** (`packages/equalizer`, the EQ panel and its i18n) and **web** (the REPL wiring). Small enough to implement in the main session (tech §2.5); **tests** own slice 4; bookkeeping is slice 5.

---

- [x] **Slice 1: Parse a profile**
  - [x] 1.1 `packages/equalizer/profile.ts`: `parseEqProfile`, `resolveEqProfile`, `matchingPreset`, `sameEqSettings` (tech §2.1), JSDoc, exported from `index.ts`. **[Agent: strudel-audio-engineer]**
  - [x] 1.2 `packages/equalizer/test/profile.test.ts`: every reading rule incl. the malformed cases. **[Agent: strudel-audio-engineer]**

- [x] **Slice 2: What is playing**
  - [x] 2.1 `website/src/repl/playingEqProfile.ts` (tech §2.2) and its wiring in `useReplContext.tsx` (`afterEval`, `onToggle(false)`). **[Agent: strudel-web-engineer]**

- [x] **Slice 3: Panel and i18n**
  - [x] 3.1 `EqualizerRecommendation.tsx`, `useDescriptionLines` in `EqualizerPresetDescription.tsx`, the block and `handleApplyProfile` in `EqualizerUI.tsx` (both layouts). **[Agent: strudel-audio-engineer]**
  - [x] 3.2 The 5 keys in all 9 locales (tech §2.4). **[Agent: strudel-audio-engineer]**

- [x] **Slice 4: Feature Testing**
  - [x] 4.1 Map every acceptance criterion in functional-spec §2.1–2.4 to a test (store, wiring, panel on desktop and compact, Apply incl. EQ off, language). RED-validated. **[Agent: strudel-test-engineer]**

- [ ] **Slice 5: Bookkeeping**
  - [ ] 5.1 Feature map row (done), roadmap, spec Status Completed, memory (after prod). **[Agent: main]**
