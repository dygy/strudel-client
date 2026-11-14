# Technical Considerations: 029

- `packages/mixer/scratch/midiFeel.mjs`:
  - a pure `ccToFeel(value, range)` that maps 0..127 onto [min,max] logarithmically;
  - a learn state machine that mirrors `midiJog.mjs` (lazy `@strudel/midi` import, timeout, cancel);
  - conflict checks against the jog mapping (`MIDI_JOG_STORAGE_KEY`) and the other slider.
  Reuse midiJog's input-listening helpers where possible; don't duplicate the WebMidi setup.
- Runtime: `scratchRuntime.ts` gets `learnFeel('brake'|'spinUp')`, `forgetFeel(...)` and a `feelMidi` state in the store. A CC calls the existing `setFeel`.
- UI: `ScratchSection.tsx` gets a Learn or Forget button and a state hint per slider, shown only when MIDI is supported.
- i18n keys in 9 locales: `scratchFeelLearn`, `scratchFeelLearning`, `scratchFeelForget`, `scratchFeelLearnTimeout`, `scratchFeelLearnConflict`.
- Audio graph: no change.
- Upstream impact: none, since `@strudel/mixer` is fork-only.
