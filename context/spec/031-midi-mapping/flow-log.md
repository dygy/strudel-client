# Flow log — 031 MIDI mapping for everything

## 2026-11-15/16 — Steps 1–4: gather, workspace, spec/tech/tasks
- No issue (roadmap Phase 6). Prior art: jog Learn (019), feel knob Learn + one-Learn lock (029, `scratch/midiLearnShared.mjs`, owner-verified on hardware), `createMidiInputs` (CC only). No volume or crossfader controls existed; Dip automates `destinationGain`.
- Spec 031 claimed with strudel-client-4a. Worktree `../strudel-client-midi`, branch `feat/midi-mapping`, from cda4d79.
- Owner choices: speakers + headphones volume and a manual crossfader that drives the switch to the cued track; one MIDI panel with Learn/Clear; mappings in localStorage with JSON export/import.
- Decisions: speakers volume is a separate node after the EQ (Dip and recordings untouched); manual mix = transition progress from the fader (per-event envelopes); soft takeover; sides flip after a completed mix.
- Next: Step 5, audio first (slices 1–3), then web (slice 4) on its APIs.
