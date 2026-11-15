# Flow log: 029 MIDI learn for the feel sliders

- **2026-11-14 — spec, tech and tasks.** Committed as 6f1fb16.
- **Implement**, shared with 028:
  - `midiFeel.mjs` maps a CC onto the log curve.
  - `midiJog` was refactored so both share `createMidiInputs`.
  - `scratchRuntime` gets learnFeel, forgetFeel and cancelFeelLearn; `ScratchSection` gets the Learn and Forget buttons.
  - Browser: the buttons render. Learn reports `denied`, because headless Chromium refuses Web MIDI.
- **Feature testing:** all 6 ACs are covered by positive and negative tests in `ScratchFeelMidiAcceptance029.test.tsx` (27 tests), with 11 RED breaks. **Manual check is still due:** AC 1–4 with a real MIDI controller.
- **Review:** one Minor finding fixed. The jog now refuses a feel knob's CC, and only one Learn runs at a time (`midiLearnShared.mjs`, `jog.lastLearn`, `scratchMidiLearnConflict`).
- **Suite:** as in 028.
- **2026-11-15 — prod.**
  - The push 28f74c6 went red in CI at the new typecheck step (`tsc: not found` at the root). The tests passed and the deploy was skipped, so prod was unaffected.
  - Fix 2eaa7be makes typecheck use website's tsc. Run 43736168596 is green.
  - **Prod check** on strudel.dygy.app, read-only:
    - The bundle has `strudel-eq-user-presets`, `strudel-scratch-feel-midi`, `connectDirectInput` and `languageChanging`, and the old "syncing language from i18next" timer code is gone.
    - The UI shows Save as… and three Learn buttons (jog, Brake, Spin-up; real Chrome exposes Web MIDI).
    - No console errors.
- **2026-11-15 — manual check:** the owner tested MIDI Learn with a real controller and it works. That closes AC 1–4 on hardware.
