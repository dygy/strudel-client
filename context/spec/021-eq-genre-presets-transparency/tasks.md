# Tasks — 021 EQ genre presets and transparency

Areas: **audio** (`packages/equalizer`, the EQ panel and its i18n, which the feature map assigns to audio) owns slices 1–3; **tests** own slice 4; bookkeeping is slice 5.

---

- [ ] **Slice 1: Families and 47 new presets**
  - [ ] 1.1 `packages/equalizer/presets.ts`:
    - add a `family` field;
    - assign the existing 12 genre presets to their families;
    - add the 47 new presets (tech §2.1 keys, avoiding collisions with the profile keys);
    - design the values per genre within the spec 020 ranges.

    **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 Loudness vs Flat within ±3 dB for all genre presets, using the existing helper. Extend `presets.test.ts`: family membership and order, unique keys, and the 34 presets from spec 020 unchanged. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: Describe the settings**
  - [ ] 2.1 `packages/equalizer/describe.ts`: the `describeSettings` pure function (tech §2.2), with JSDoc, exported from `index.ts`, plus unit tests. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: Panel and i18n**
  - [ ] 3.1 Picker optgroups: the 4 families in the spec order, then Profiles. **[Agent: strudel-audio-engineer]**
  - [ ] 3.2 Description under the picker, on desktop and compact:
    - the localised region summary, cuts and output;
    - "No change: flat" when nothing is changed;
    - the "why" line only while a genre preset is active;
    - `aria-live="polite"`.

    **[Agent: strudel-audio-engineer]**
  - [ ] 3.3 i18n in all 9 locales: 47 names, 59 "why" sentences, family, region and template keys, and the updated subtitle (tech §2.4). **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: Feature Testing**
  - [ ] 4.1 Map each acceptance criterion in functional-spec §2.1–2.3 to a test. Cover the panel's groups and members, the description and "why" behaviour, Custom and Flat, compact, the language switch, and i18n completeness. Everything RED-validated. **[Agent: strudel-test-engineer]**

- [ ] **Slice 5: Bookkeeping**
  - [ ] 5.1 Feature map row, roadmap, spec Status Completed, memory. **[Agent: main]**
