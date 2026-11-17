# Technical Specification: Loudness Meter and Analyser

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Draft
- **Author:** Claude (for the owner)

---

## 1. High-Level Technical Approach

The measurement runs in **one AudioWorklet**, `loudness-meter-processor`. It takes two inputs, both passive taps on the main AudioContext:

```
… → destinationGain → [EQ input ─┬─ bands … outputGain ─┬─ limiter → trim → clipper → wet ─┐ ] → speakers volume → destination
                                 │                       │                                 ├─(EQ output)──┐
                                 │                       └──▶ input 1 (pre-limiter)       │              │
                                 └──▶ pre-EQ AnalyserNode (spectrum layer, §2.6)           │              ▼
                                                                          input 0 (post-EQ) ◀────────────┘
```

- **Input 0, post-EQ:** the main EQ's final output, `getMainEqualizerOutputTap()`. This is what Record as heard records and what the speakers volume receives.
  - With no EQ installed, it falls back to superdough's `destinationGain`, the same rule as the spec 030 `resolveMeterSource`.
- **Input 1, pre-limiter:** the EQ's `outputGainNode`, the limiter input. It is connected only while the EQ exists and is **enabled**.
  - The EQ "off" path bypasses the limiter, so there is no limiter to warn about.
  - In that case the processor's "clip" check runs on input 0 instead (functional §2.4 reason 3).

The processor holds the pure DSP core: K-weighting, 100 ms blocks, M/S/I with gating, LRA, 4× true peak, peak/RMS and over events. It posts a snapshot to the main thread every 100 ms.

The app runtime (`website/src/repl/meter/`) adds the rest:
- it installs and follows the taps;
- it keeps the latching warning, the 60 s history and the reset rules;
- it exposes a store to the React UI: the header strip, the performance strip and the Settings → Meter panel.

The before-EQ spectrum is a second `AnalyserNode`, made by a new `AudioEqualizer.createAnalyserTap({ point: 'input' })`. EqualizerUI draws it as a paler layer behind the 026 spectrum.

Nothing is put on the speakers' path. The worklet has `numberOfOutputs: 0`, and its `process` returns `true` while it is installed. So there is no ramp to design and nothing audible.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Pure DSP core (`packages/mixer/meter/loudnessCore.mjs`, new)

These are plain functions and classes with no Web Audio, so they can be unit-tested with synthetic buffers.

- **`kWeightingCoefficients(sampleRate)`:** the BS.1770-4 two-stage filter (high-shelf pre-filter + RLB high-pass).
  - Derived from the analog prototypes (f0, Q, gain) by the bilinear transform, as libebur128 does.
  - At 48 kHz it must reproduce the standard's tabulated coefficients to 1e-6.
  - Any sample rate works: 44.1, 48, 96 kHz.
- **`LoudnessMeterCore`:**
  - `constructor({ sampleRate, channels })`, `process(channelsArrays, preLimiterArrays?)`, `snapshot()`, `reset()`.
  - Per channel there are two biquads in transposed direct form II, with state kept across calls.
  - **Blocks:** the squared K-weighted samples accumulate into 100 ms sub-blocks per channel. The channel weights are all 1.0: input is up-mixed to 2 channels, so a mono source counts as L = R.
  - **Momentary:** the mean of the last 4 sub-blocks (400 ms).
  - **Short-term:** the mean of the last 30 sub-blocks (3 s).
  - **Integrated:** gating blocks are 400 ms long with a 100 ms hop.
    - The absolute gate is −70 LUFS; the relative gate is −10 LU from the absolute-gated mean.
    - Gating-block powers live in a **histogram** of 0.01 LU bins from −70 to +5 LUFS. That is 7500 bins holding count and power sum, so memory stays flat for a set of any length.
    - Each bin keeps the exact power sum, so the result isn't quantised. Only the gate edge is resolved to the bin width.
  - **LRA:** uses the short-term values (3 s window) at a 100 ms hop.
    - The absolute gate is −70 LUFS and the relative gate −20 LU.
    - LRA is the 95th minus the 10th percentile, kept in a second histogram.
    - It is `null` until 10 s of short-term values exist.
  - `loudness = −0.691 + 10·log10(Σ meanSquare)`. Silence, or power below the absolute gate, gives `null`.
- **True peak:** 4× oversampling with the BS.1770-4 Annex 2 48-tap, 4-phase FIR, per channel, with history across calls. It reports both the block maximum and the maximum since reset, in dBTP.
- **Sample peak and RMS:** per channel, over the last 300 ms (a running sum over a ring of squared samples). Values are in dBFS.
- **Over events (functional §2.4):** each of the three reasons, `truePeak` (> −1 dBTP), `limiter` (pre-limiter |x| ≥ `OVER_LINEAR`, the −0.3 dBFS ceiling) and `clip` (post-EQ |x| ≥ 1.0, checked only when no pre-limiter input is present), keeps:
  - a count;
  - a `lastAt` sample index.

  A new event starts when the previous one is ≥ 0.5 s old. The comparison uses `Math.fround`, the same float32 trap that 030's `OVER_SAMPLE` documents.
- **The snapshot** is plain, structured-cloneable data: `{ m, s, i, lra, tpMax, tpBlock, peakDb[2], rmsDb[2], events: {truePeak, limiter, clip}, measuredSeconds }`. Loudness values are `null` for silence.

`packages/mixer/meter/loudnessWorklet.mjs` (new) is a processor class around the core, with the core inlined by the bundler as in 032.
- Options: `channelCount: 2`, `channelCountMode: 'explicit'`, `channelInterpretation: 'speakers'` on both inputs.
- It posts `snapshot()` every 4800 frames (100 ms at 48 kHz; derived from `sampleRate`).
- `port` messages: `{ type: 'reset' }` and `{ type: 'dispose' }`. After `dispose`, `process` returns `false`.
- When an input array is empty because it isn't connected, that input is treated as silence and the snapshot marks it absent. An absent input 1 means the `clip` reason uses input 0.

`packages/mixer/meter/loudnessLoader.mjs` (new) is a copy of `beatRepeatLoader.mjs`'s pattern. It loads `loudnessWorklet.mjs?audioworklet` once per AudioContext and doesn't cache a failed load.

`packages/mixer/meter/LoudnessMeter.mjs` (new) is the node owner.
- `await LoudnessMeter.create(audioContext)` makes the `AudioWorkletNode`.
- `attach({ postEq, preLimiter })` connects `postEq → node input 0` and `preLimiter → node input 1`. Calling it again disconnects exactly the previous edges first.
- `reset()`, `onSnapshot(cb)` and `destroy()`. `destroy()` disconnects only the edges it made, posts `dispose` and closes the port.

Exports and types go in `packages/mixer/index.mjs` / `index.d.ts`, with a README section. JSDoc goes on the public functions.

### 2.2 AudioEqualizer additions (`packages/equalizer/AudioEqualizer.ts`, additive)

- **`createAnalyserTap({ point?: 'output' | 'input', fftSize?, smoothingTimeConstant? })`:**
  - `'input'` taps `inputNode`, the signal entering the EQ, i.e. before the EQ.
  - The default stays `'output'`, so existing callers are unchanged.
  - The same dispose and tracking rules apply, so `destroy()` disconnects both kinds.
- **`getLimiterInput(): AudioNode | null`:** returns `outputGainNode` while enabled, or `null` while off or destroyed.
- **Re-attach notice:** the meter must re-attach when `setEnabled` changes or `setChannelCount` rebuilds the limiter stage.
  - The existing `subscribeMainEqualizer` fires only on install/remove, so add an EQ-level `onTopologyChange(listener)`.
  - Alternatively the runtime re-resolves on a 250 ms throttle like 030's meter. Prefer the explicit listener.
  - The `outputGainNode` itself isn't rebuilt by `setChannelCount`, only the limiter stage is. Check this and document what holds.

### 2.3 App runtime (`website/src/repl/meter/`, new)

**`meterSettings.ts`**
- localStorage key `strudel-loudness-meter`: `{ on: boolean, target: -14 | -23 | -9 | null }`.
- The default is `{ on: true, target: -14 }`. It is sanitised on load: an unknown value falls back to the default, the same as 032's settings.
- The Before EQ toggle uses a separate key, `strudel-eq-spectrum-pre`, on the 026 pattern (`'true'`/`'false'`, off when absent).

**`loudnessRuntime.ts`**, a singleton like `masterFxRuntime`:
- **`installWhenReady(audioReady)`:** ref-counted, because `useReplContext` is mounted more than once. It runs after superdough's `initAudio` and only while `on`.
  - It creates the `LoudnessMeter` on the main context.
  - It attaches `postEq = getMainEqualizerOutputTap() ?? destinationGain` and `preLimiter = getMainEqualizer()?.getLimiterInput() ?? null`.
  - It re-attaches on `subscribeMainEqualizer` and on the EQ topology listener.
  - It re-attaches after superdough's output reset rebuilds `destinationGain`. Only the fallback case can be affected: the EQ instance is kept across resets (mainEqualizer.ts).
- **Switching `on` off** destroys the meter: no worklet and no tap. Switching it on installs again.
- **Store:** a nanostores `atom` (the app's pattern) holding:
  - the latest snapshot;
  - the **latching warning** `{ lit: boolean, reasons: Set }`. It is lit when any event count rises, `clearWarning()` turns it off, and the counts stay;
  - the **history**: a ring of `{ t, m, s, warn }` at 10 Hz covering 60 s (600 entries).
- **Reset rules (functional §2.3):**
  - **`setPlaying(started, { switching })`** is called from `useReplContext` with `isSmoothTransitioningRef.current`.
    - A false → true edge resets the core (`meter.reset()`), the history and the warning, but **only if the preceding stop was not a track switch**.
    - The instant switch (spec 017) stops and restarts the scheduler, which must not reset Integrated.
    - Update while playing never toggles `started`. **Verify this.**
  - **On stop,** M and S are shown as `null` and the history stops appending. I, TP, LRA and the counts are frozen at their last values.
  - **`reset()`** is the panel button.
- **The rAF and visibility rules** live in the components, not the runtime. The runtime only stores the snapshot as it arrives, which is cheap: 10 Hz.

**`useLoudness.ts`:** `useStore` wrappers for the components.

### 2.4 UI (`website/src/repl/components/meter/`, new)

- **`LoudnessStrip.tsx`:** the Short-term number, a thin bar from −36 to 0 LUFS with a target tick, and `WarningLight`.
  - The colour rule follows functional §2.5.
  - Clicking the number opens Settings → Meter, using the panel-open/scroll mechanism other settings links use.
  - If none exists, open the settings tab and scroll by `id`.
- **`WarningLight.tsx`:** a button with an `aria-label` that names the reasons and counts. Clicking it calls `clearWarning`. A long press shows the same text as a tooltip.
- **`LoudnessHistory.tsx`:** a `<canvas>` for 60 s, with S as a line, M as a faint line, a target line and warning marks.
  - It redraws in rAF only while the panel is visible, the tab is visible and the store changed.
  - It stays `dir="ltr"`.
- **`MeterPanel.tsx`:** the readings (M, S, I large, TP, LRA), the L/R peak and RMS bars, the history, the target select, the warning counts, Reset, and the on/off switch.
- **Placement:**
  - `Header.tsx`: next to the Perform button. It is hidden when `compact` (that path returns early anyway) and when the meter is off.
  - `PerformanceStrip.tsx`: beside the existing `LevelMeter`.
  - `SettingsTab.tsx`: after `<MasterFxPanel />`, as `<FormItem label={t('loudnessMeter')}>` with `id="settings-meter"`.
- **`EqualizerUI.tsx` / `EqualizerListeningControls.tsx`:**
  - the Before EQ toggle;
  - a second tap `createAnalyserTap({ point: 'input' })`, opened only while `spectrumOn && preOn && speakersPlaying`;
  - the pre-EQ layer drawn first, in a paler tint, reusing `spectrumPoints`.

  The same rAF loop and the same dispose rules as 026 apply.
- **i18n:** new keys under `meter.*` and `eqSpectrumPre` go into all 9 locales and `types.ts`. Readings use `Intl.NumberFormat` with one decimal; the units stay as literals (LUFS, LU, dBTP, dBFS).

### 2.5 Data, runtime, upstream

- **Data:** none. No Supabase table, no migration, no `supabase_schema.sql` change.
- **Runtime:** browser only. No Worker or SSR code, no new page, no env var or secret. The worklet is a `data:` URL inside the client bundle, so the Worker script size is unaffected. Check `_worker.js` stays at about 2.7 MiB.
- **Upstream:**
  - `@strudel/equalizer` gains an optional parameter and one getter, both additive.
  - `@strudel/mixer` gains new exports.
  - No `core`, `mini` or `superdough` change.

---

## 3. Impact and Risk Analysis

- **Audio continuity:** the taps are fan-out edges into a node with no outputs. Adding or removing an edge from a node that also feeds the speakers doesn't change what the speakers get. This is the same reasoning as the 026 spectrum and the 030 meter.
  - The risk is a wrong `disconnect()` call that removes the speakers' edge. **Always disconnect with an explicit destination** (`source.disconnect(node, output, input)`), never a bare `disconnect()` on a node we don't own. A test checks that the EQ output's edge to the speakers volume survives `destroy()`.
- **The worklet isn't pulled without outputs:** Chrome, Firefox and Safari process an `AudioWorkletNode` with zero outputs while it has connected inputs and returns `true`. **Verify this in the browser.**
  - If any engine doesn't, fall back to `numberOfOutputs: 1` → a GainNode at 0 → destination. A 0-gain edge is inaudible.
- **CPU:** per sample and channel there are 2 biquads, 4×12 FIR MACs and a few adds. At 48 kHz stereo that is about 10 M ops/s, well within a worklet.
  - Snapshots go out at 10 Hz, at about 200 bytes each.
  - The histograms are allocated once, at 2 × 7500 × 2 Float64.
- **Track switch reset trap:** the instant switch toggles `started`. It is guarded by the `switching` flag (§2.3) and has a test.
- **Two `useReplContext` mounts:** the ref-counted install means one worklet node only. A test checks it.
- **Hidden tab:** the worklet keeps measuring, so Integrated stays correct. The UI doesn't draw.
- **Multichannel orbits (more than 2 channels):** the inputs are explicitly 2-channel with speaker down-mix. Loudness is then measured on the stereo down-mix. This is documented as a limit.
- **Accuracy:** the EBU Tech 3341 / 3342 cases that can be synthesised in a test cover the core: the stereo sine, the gating sequences, the true-peak 45° case and the LRA steps.

---

## 4. Testing Strategy

- **`packages/mixer/test/loudnessCore033.test.mjs`:**
  - K-weighting coefficients at 48 kHz against BS.1770-4.
  - A stereo 1 kHz sine at −23 dBFS gives M, S and I at −23.0 ± 0.1.
  - Sine then silence leaves I unchanged, and M and S become `null`.
  - −23 then −43 dBFS: relative gating keeps I at about −23.
  - EBU 3342-style LRA steps: −20/−30 alternating gives LRA ≈ 10 ± 1.
  - A quarter-sample-rate sine at 45° with sample peak −3.01 gives TP 0 ± 0.5.
  - The three over reasons, each with its negative pair, plus the 0.5 s event merge.
  - `reset()` clears everything; a mono input counts as L = R.
- **`packages/mixer/test/loudnessMeter033.test.mjs`** (mock AudioContext, the 032 style):
  - `attach` edges and re-attach;
  - `destroy` removes only its own edges, and the speakers edge survives;
  - the loader is called once per context, and a failed load is retried.
- **`packages/equalizer/test/analyserTapInput033.test.ts`:**
  - the `'input'` point connects from `inputNode`;
  - the default is unchanged;
  - `getLimiterInput` returns `null` while off.
- **`website/src/repl/meter/__tests__/`:**
  - The runtime: one meter for two installs; re-attach on EQ install/remove.
  - The reset rules: Play after Stop resets; the instant-switch stop/start doesn't; a set Go doesn't; Update doesn't; Reset does.
  - The latching warning and `clearWarning`.
  - The history keeps 600 entries and freezes on stop.
  - The settings sanitising.
- **Components:**
  - The strip's colour thresholds; the strip is hidden when the meter is off.
  - Warning light clear and its aria text.
  - The panel's target persistence.
  - The header shows no strip in compact layout.
  - The Before EQ toggle opens and closes the second tap.
- **i18n:** a keys-present test across all 9 locales (the existing pattern).
- **Browser (verify step):**
  - On the dev server, measure through `import('/src/repl/meter/loudnessRuntime.ts')`.
  - Inject a −23 dBFS 1 kHz stereo oscillator into `destinationGain` with the EQ off: M, S and I read −23 ± 0.3.
  - Speakers volume at 20 %: S changes by less than 0.1.
  - EQ output gain +12 dB: the limiter warning appears.
  - Pre/post spectrum with +12 dB at 100 Hz.
  - Node counts and edges before and after on/off ×5.
  - Screenshots: the header, the panel in LTR and Hebrew, the performance strip at 375 px.
