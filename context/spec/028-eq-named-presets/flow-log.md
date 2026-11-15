# Flow log: 028 named EQ presets

- **2026-11-14 — spec, tech and tasks.** Owner: "go do all please" (the second list of improvements). Committed as 6f1fb16. Built in worktree ../strudel-client-4a.
- **Implement:** one strudel-audio-engineer dispatch, shared with 029.
  - `userPresets.ts`, `EqualizerUserPresets.tsx`, and the "My presets" group first in the picker.
  - `validateEqualizerSettings` keeps `user:` names.
  - `glideToSettings` is shared with the A/B switch.
  - Browser: Save, rename and delete work; Delete asks inside the panel with no dialog; a pick glides 0→12 dB over 43 ms.
- **Feature testing:** one strudel-test-engineer dispatch, shared with 029. All 6 ACs are covered by positive and negative tests in `EqualizerUserPresetsAcceptance028.test.tsx` (31 tests), with 15 RED breaks.
- **Review:** one strudel-reviewer dispatch, shared. Two Minor findings fixed:
  - Rename relabelled an edited Custom slot.
  - A preset deleted in another tab gave no message (`equalizerPresetMissing`).
- **Suite:** 236 files / 4910 tests, shuffled, on Node 24.12. Format, lint, `typecheck` and `build:cloudflare` are clean.
- **2026-11-15 — prod.**
  - The push 28f74c6 went red in CI at the new typecheck step (`tsc: not found` at the root). The tests passed and the deploy was skipped, so prod was unaffected.
  - Fix 2eaa7be makes typecheck use website's tsc. Run 43736168596 is green.
  - **Prod check** on strudel.dygy.app, read-only:
    - The bundle has `strudel-eq-user-presets`, `strudel-scratch-feel-midi`, `connectDirectInput` and `languageChanging`, and the old "syncing language from i18next" timer code is gone.
    - The UI shows Save as… and three Learn buttons (jog, Brake, Spin-up; real Chrome exposes Web MIDI).
    - No console errors.
