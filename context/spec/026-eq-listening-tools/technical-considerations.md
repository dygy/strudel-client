# Technical Considerations — 026 EQ listening tools

## 1. Facts (verified 2026-11-14)

- `packages/equalizer/AudioEqualizer.ts` is the strip: input → dry/wet → cuts → 10 bands → output gain → limiter → clipper → output. `getInput()` exists. The 6 ms dry delay and look-ahead are present "on and off alike" (line ~63).
- `website/src/repl/mainEqualizer.ts`:
  - installs the main EQ as superdough's output insert after `audioReady`;
  - is ref-counted;
  - exposes `getMainEqualizer()` and `subscribeMainEqualizer()`.

  Its header documents the constant latency, which is why the MIDI-latency item is dropped.
- `website/src/repl/components/panel/EqualizerUI.tsx`:
  - a canvas (`canvasRef`, around line 125);
  - a rAF loop through a `{request, cancel}` pair (around line 166–175; calling rAF through an object throws "Illegal invocation", so keep the arrow wrappers);
  - `drawGrid`, `drawFrequencyResponse` and `drawBandMarkers`;
  - `equalizers()`, which gives the main and preview instances.

  Spec 024's `EqualizerRecommendation` is mounted here (on main since 36b8c4b).
- `packages/equalizer/persistence.ts` has `saveEqualizerSettings` / `loadEqualizerSettings` (with validation) and `applyEqualizerSettings`.
- `packages/equalizer/response.ts:167` `pinkNoiseLoudnessDb` is the loudness helper. `presets.test.ts` checks genre presets within ±3 dB. Spec 021's change log names the 4 loud profiles.
- Recording: `website/src/repl/recording/useAudioRecorder.ts:72` takes `controller.output.destinationGain` and passes it to `AudioRecorderEngine.start(destinationGain)`. `ScreenRecorderEngine.start(destinationGain)` connects `destinationGain → mediaStreamDestination` (line ~127) and disconnects it on stop (around line 333). Find the screen recorder's caller.

## 2. Design

### 2.1 A/B slots (`packages/equalizer` + panel)

- Pure module `packages/equalizer/slots.ts`:
  - `type EqualizerSlots = { active: 'A'|'B'; A: EqualizerSettings; B: EqualizerSettings }`
  - `loadEqualizerSlots()` and `saveEqualizerSlots()` under a new key `strudel-eq-slots`. Each slot is validated with the existing settings validator; a bad slot falls back to a copy of the good one, or to the defaults.
  - Migration: if there are no slots but legacy settings exist, both A and B become copies of the legacy settings.
  - `saveEqualizerSettings` keeps writing the active slot to the legacy key too, so older code paths (`loadEqualizerSettings` used by PreviewEngine and mainEqualizer at install) see the active settings. This is the only writer change. Document it.
  - Export from `index.ts`, with JSDoc.
- Panel:
  - an `A | B` segmented control and a Copy button (its label follows the direction);
  - a switch calls the existing apply path (the same one presets use, which glides) on both equalizers;
  - an edit writes to the active slot;
  - spec 024 Apply writes to the active slot.
- Compact (`EqualizerCompact.tsx`) gets the same control.

### 2.2 Spectrum

- `AudioEqualizer` gets an optional tap: `getOutput()` (the clipper output node, read-only use) or a `createAnalyserTap(): {analyser, dispose}` that connects an `AnalyserNode` (fftSize 4096, smoothingTimeConstant 0.8) as a fan-out from the final output. Prefer the second, so the EQ owns connect and disconnect.
- A fan-out has no effect on the output samples. Prove it in a test against the node graph (output connections unchanged except the analyser) and in the browser.
- The panel's rAF draw reads `getFloatFrequencyData` and draws a filled, low-alpha path on the curve's log-frequency axis. It uses `frequencyToX` from `utils.ts`, and maps dB to y over −100…0 dBFS onto the canvas height.
  - It draws only while the panel is mounted, the spectrum is on, and the main EQ exists. Otherwise it calls dispose.
  - When the AudioContext isn't running or the transport is stopped, it draws one empty frame and stops requesting frames. It resumes on play, through the existing playing signal.
- Toggle stored as `strudel-eq-spectrum` (`'true'`/`'false'`, default on).

### 2.3 Record as heard

- Add to `mainEqualizer.ts`: `getMainEqualizerOutputTap(): AudioNode | null`, the EQ's final output node or a gain fed from it, or null when not installed.
- Recording hooks: when the option (`strudel-record-post-eq`, default false) is on, pass that node instead of `destinationGain`. Otherwise, or when it is null, use `destinationGain`.
- Both engines already connect the given node to their destination and disconnect it on stop, so they keep working with any AudioNode. Widen the parameter type from `GainNode` to `AudioNode`.
- The tap is chosen at start; a change mid-recording applies next time.
- If superdough's output reset swaps the insert mid-recording (a click-free swap, spec 020), the recording keeps its tap. The EQ instance survives reset; verify that and say so.
- The UI checkbox goes where the recording options live (find it: the recording panel or the settings tab).

### 2.4 Profiles

- `presets.ts`: lower `output` for acoustic, bassBoost, piano and rnb until `pinkNoiseLoudnessDb` is within ±3 dB, rounded to 0.5 dB steps, using the smallest change that does it. Do not touch the bands.
- `presets.test.ts`: the ±3 dB check covers all presets. Assert those four profiles' bands are unchanged.
- Confirm that saved settings store values (persistence) and that a load never re-derives values from the preset key. If it does, stop and report.
- Amend the spec 021 change log: AC 2.1.4 is restored by 026.

### 2.5 i18n

New keys in all 9 locales `settings.json`: `equalizerSlotA`, `equalizerSlotB`, `equalizerCopyAtoB`, `equalizerCopyBtoA`, `equalizerSlotsHint`, `equalizerSpectrum`, `equalizerSpectrumHint`, `recordPostEq`, `recordPostEqHint`. If the recording strings live in another namespace, use that one.

## 3. Audio graph

| Node | Created | Disconnected | Notes |
|---|---|---|---|
| AnalyserNode | when the spectrum is on and the main EQ exists | when the spectrum is off, the panel unmounts, or the EQ is destroyed | fan-out; no effect on the output |
| Recording tap | none new; it reuses the EQ's output node | the engines disconnect their connection on stop | |

A/B switches use the existing glides (`setTargetAtTime`). There are no new ramps.

## 4. Tests

- Slots: load, save, migration, validation fallback, copy.
- Analyser tap: connect and dispose, output connections unchanged.
- Recording: tap selection on, off, and null fallback, for both engines and their hooks.
- Profiles: all 81 within ±3 dB, bands unchanged.
- Panel: A/B switching drives both EQs, edits stay in their slot, Apply goes to the active slot, Spectrum toggle, i18n completeness.

## 5. Runtime and data

Browser only. There is no Supabase change, no Worker change, and no new env vars. The localStorage keys are `strudel-eq-slots`, `strudel-eq-spectrum` and `strudel-record-post-eq`.

## 6. Upstream impact

None. `@strudel/equalizer` and the recording code exist only in this fork, and superdough is untouched.
