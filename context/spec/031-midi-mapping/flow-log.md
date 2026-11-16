# Flow log — 031 MIDI mapping for everything

## 2026-11-15/16 — Steps 1–4: gather, workspace, spec/tech/tasks
- No issue (roadmap Phase 6). Prior art: jog Learn (019), feel knob Learn + one-Learn lock (029, `scratch/midiLearnShared.mjs`, owner-verified on hardware), `createMidiInputs` (CC only). No volume or crossfader controls existed; Dip automates `destinationGain`.
- Spec 031 claimed with strudel-client-4a. Worktree `../strudel-client-midi`, branch `feat/midi-mapping`, from cda4d79.
- Owner choices: speakers + headphones volume and a manual crossfader that drives the switch to the cued track; one MIDI panel with Learn/Clear; mappings in localStorage with JSON export/import.
- Decisions: speakers volume is a separate node after the EQ (Dip and recordings untouched); manual mix = transition progress from the fader (per-event envelopes); soft takeover; sides flip after a completed mix.
- Next: Step 5, audio first (slices 1–3), then web (slice 4) on its APIs.

## 2026-11-16 — Step 5a: audio (slices 1–3)
- strudel-audio-engineer: `packages/mixer/midi/midiMap.mjs`, `volume.mjs`, shared registry in `scratch/midiLearnShared.mjs` (jog/feel refuse map controls), note parsing in `createMidiInputs`, `PreviewEngine.setVolume`, `website/src/repl/speakersVolume.ts` (destinationGain → EQ → speakersVolume → destination), controller `beginManual`/`setManualProgress`/`handManualToTimed`, `buildTransition` `progressAt`.
- Deviations to review: status/learn reason `'failed'`; manual mix never queued; manual Jump sets tempo at T; abandon releases every voice started since just before T (old track's too — superdough can't tell them apart); complete fades old voices over 0.1 s; strict import.
- Main-context check: 251 files / 5155 tests; RED spot-check registry (map lookup removed → 2 failed; restored → 46 passed).
- Next: web slice 4.

## 2026-11-16 — Step 5b: web (slice 4)
- strudel-web-engineer: `repl/eqStore.ts` (EQ panel A/B + setters lifted; panel and MIDI share it), `repl/headphonesVolume.ts`, `repl/midi/{midiTargets,crossfader,midiMapContext}.ts`, `useMidiMap.tsx` (mounted in ReplEditor), `setBridge.manualGo` sharing go's preview stop + forced switch, `evaluateNewTrack` `manual`, `trackSwitch.restorePlaying`, `MidiSettings.tsx`, `MixerLevels.tsx`, PerformanceStrip crossfader, 61 keys × 9 locales.
- Deviations to review: inert while stopped; a mix starts only after the fader returns to the playing end; crossfader row LTR in RTL; band values snap 0.5 dB; editor manual mix uses force (no instant fallback); after abandon the EQ recommendation/title/active code still show the new track.
- Main-context check: 257 files / 5238 tests; tsc 0.
- Next: test slice (parallel) + browser verify with stubbed requestMIDIAccess.

## 2026-11-16 — Step 6: browser verify (temp signed-out harness on :4338, deleted after)
- Fake Web MIDI (EventTarget input) behind the real `@strudel/midi`/WebMidi path; for the reload check it was installed with `page.addInitScript`.
- No stored bindings → `requestMIDIAccess` not called on load (asked 0); first Learn → asked 1.
- Learn Band 1 with 3 × CC 21 → bound, stored in `strudel-midi-map`, row "Move to pick up"; after crossing the current value: CC 127 → +24 dB, 0 → −24 dB, 64 → 0 dB in `eqStore`.
- Reload: binding active without Learn (access requested on load since bindings exist); pickup then 127 → +24.
- Crossfader (CC 30), editor-track path A playing → B in editor: waiting until T=7.5 (Snap), start, manual p 0.16→0.31→0.55→0.79→0.94→1, end manual:true, playing zzB.
- Abandon from the right (playing) end with A in the editor: p = 1−x (0.13→0.37→0.21→0.06→0), end abandoned:true, playing back to zzB, scheduler running.
- RTL (he) panel screenshot docs/screenshots/031-midi-panel-rtl.png. Look: bound rows wrap Learn/Clear onto a second line.
- Not run in browser: set-cued crossfader path (no sets signed out; unit-tested), Dip at 50 % (unit-tested), headphones volume (no preview engine in harness). Speakers volume ramp was measured by the audio engineer (no step larger than the sine's own).

## 2026-11-16 — Step 5c: feature testing
- strudel-test-engineer: +28 tests (`midiPanelLive031`, `crossfaderLive031`, `volumeOutputs031`), AC table, RED→GREEN per §2.1–2.5; 029 jog/feel tests byte-identical and green. Gaps: Esc doesn't cancel a jog/feel Learn started from the MIDI panel; `MidiSettings031` import test waits one setTimeout(0) (possible flake).
- Main-context: suite re-run (below). Next: review.

## 2026-11-16 — Step 7: review
- review/031-midi-mapping.md: 2 Major (abandon drops old-track notes; old notes ring on after complete), 7 Minor. No lost-work path.
- Owner: Major 1–2 fixed by tagging voices by side (additive superdough fork addition) → audio; #3–7, #8, #9 and Esc for jog/feel Learn → web. All accepted.

## 2026-11-16 — Review fixes, final gates
- Audio: voice side tagging (superdough.mjs +5 additive lines: `activeSoundSides`, `getActiveSoundIds(owner, side)`, record `_mixSide`); abandon releases 'new' only; complete/hand-over release non-'new' (hand-over fade after 0.3 s so lookahead voices have started). RED→GREEN ×3.
- Web: #3 `abandonedMix.ts`, #4 cue(captured code), #5 'cancelled', #6 hand-over without a set, #7 holder names (`holderName.ts`, `midiTargetMeta.ts`, midiFeel `labelOf`), Esc via the shared lock, #8 vi.waitFor, #9 row layout. RED→GREEN ×5.
- The audio engineer ran `pnpm run codeformat` repo-wide by mistake: no files outside the 031 set changed (59 files, all 031).
- Gates: Node 24.12 ×2 and Node 26 → 262 files / 5288 tests, exit 0; tsc 0; format; lint 0; build:cloudflare OK, worker 2.7M.
- Flow defect: parallel agents shared one scratchpad script name (`redgreen.sh`) and clobbered it; one run created stray empty files (deleted). Use mktemp script names.
