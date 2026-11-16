# Tasks: MIDI Mapping for Everything (031)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

- [ ] **Slice 1: MIDI input, shared registry, map engine (audio)**
  - [ ] 1.1 `packages/mixer/scratch/midiJog.mjs`: `createMidiInputs` parses note-on/off (velocity-0 note-on = off) → `onNote`; optional ref-counted shared hub (tech §2.1). **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 `packages/mixer/scratch/midiLearnShared.mjs`: control identity with `kind`, backward-compatible `sameMidiControl`, `midiControlHolder` across jog/feel/map; jog and feel conflict checks consult the map — 019/029 behaviour otherwise unchanged (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [ ] 1.3 `packages/mixer/midi/midiMap.mjs` + export from `packages/mixer/index.mjs`: storage, lazy access, learn (continuous 3-in-300 ms, button first press, 10 s, cancel, conflicts), soft takeover with `notifyExternalChange`, button edges, export/import, status, subscribe (tech §2.3). **[Agent: strudel-audio-engineer]**
  - [ ] 1.4 Tests for 1.1–1.3 in `packages/mixer/test/` (positive + negative pairs); existing jog/feel tests unchanged and green. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: Volumes (audio)**
  - [ ] 2.1 `packages/mixer/volume.mjs`: taper (unity at 1), ramped setter, persistence keys (tech §2.4). **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 Speakers volume node as the last node of the main output, separate from `destinationGain`, surviving superdough reset and EQ swaps, upstream taps unaffected; getter for the app (tech §2.4). **[Agent: strudel-audio-engineer]**
  - [ ] 2.3 Headphones volume node at the end of `PreviewEngine` output (tech §2.4). **[Agent: strudel-audio-engineer]**
  - [ ] 2.4 Tests: taper/ramp/unity, Dip restores to the volume level (destinationGain untouched by volume), reset survival. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: Manual mix in the controller (audio)**
  - [ ] 3.1 `transitions/buildTransition.mjs`: optional `progressAt` (tech §2.5). **[Agent: strudel-audio-engineer]**
  - [ ] 3.2 `TrackTransitionController.mjs`: `beginManual`, `setManualProgress` (complete ≥ 0.98, abandon ≤ 0.02 after leaving), `handManualToTimed`, type mapping, tempo per mode, state/event (tech §2.5). **[Agent: strudel-audio-engineer]**
  - [ ] 3.3 Tests per tech §2.5; `packages/mixer/README.md` section on manual mix and its event granularity. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: App wiring and UI (web)** — after slices 1–3 land (consumes their APIs)
  - [ ] 4.1 `website/src/repl/midi/midiTargets.ts`: the §2.1 targets; EQ through the panel's state path (lift a small store if needed); next/previous type; perf toggle; Cue/Go via set player (tech §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 4.2 `website/src/repl/midi/useMidiMap.tsx` + mount in `ReplEditor` (tech §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 4.3 `website/src/repl/midi/crossfader.ts` + set player/bridge `manualGo` path + trackSwitch manual path; complete/abandon/hand-over flows (tech §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 4.4 `components/panel/MidiSettings.tsx` in the Settings tab; volume + crossfader sliders in `MixerSettings.tsx`; compact crossfader in `PerformanceStrip.tsx` (tech §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 4.5 i18n: all new keys in 9 locales + `types.ts`. **[Agent: strudel-web-engineer]**
  - [ ] 4.6 Component/unit tests per tech §4 (web). **[Agent: strudel-web-engineer]**

- [ ] **Slice 5: Feature testing**
  - [ ] 5.1 AC → test/browser-check table; gaps filled with positive + negative pairs; RED-validate one guard per §2.1–2.5. **[Agent: strudel-test-engineer]**

- [ ] **Slice 6: Verify (main context)**
  - [ ] 6.1 Suites (Node 24.12 ×2 and Node 26), tsc, format, lint, `pnpm build:cloudflare` (jsdoc!) + worker size.
  - [ ] 6.2 Browser with a stubbed `requestMIDIAccess`: learn/drive/reload, volume ramp, manual crossfade complete + abandon, Dip at 50 %, RTL panel screenshot.

- [ ] **Slice 7: Bookkeeping**
  - [ ] 7.1 `context/product/feature-map.md` row (MIDI mapping, volumes, manual crossfader); scratch row note on the shared registry.
  - [ ] 7.2 Roadmap tick, spec Status Completed after prod verification, memory note. No migration.
