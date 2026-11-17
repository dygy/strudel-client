# Tasks: Loudness Meter and Analyser (033)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

- [ ] **Slice 1: DSP core and worklet (audio)**
  - [ ] 1.1 `packages/mixer/meter/loudnessCore.mjs` (pure), covering tech §2.1:
    - K-weighting coefficients for any sample rate;
    - 100 ms sub-blocks, M/S, histogram-gated Integrated, LRA;
    - 4× true peak (BS.1770-4 Annex 2 FIR), 300 ms peak/RMS;
    - the three over reasons with a 0.5 s event merge and float32 comparisons;
    - `snapshot()`/`reset()`.

    **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 `packages/mixer/meter/{loudnessWorklet,loudnessLoader,LoudnessMeter}.mjs` (tech §2.1):
    - 2 explicit stereo inputs, 0 outputs, a snapshot every 100 ms;
    - `reset`/`dispose` messages;
    - an absent input 1 → the clip reason runs on input 0;
    - `attach`/`destroy` that touch only their own edges;
    - exports and types from `packages/mixer/index.mjs` / `index.d.ts`, and a README section.

    **[Agent: strudel-audio-engineer]**
  - [ ] 1.3 `packages/equalizer/AudioEqualizer.ts` (tech §2.2):
    - `createAnalyserTap({ point: 'input' })`;
    - `getLimiterInput()`;
    - `onTopologyChange(listener)` for enable/disable and the limiter stage rebuild;
    - JSDoc.

    **[Agent: strudel-audio-engineer]**
  - [ ] 1.4 Tests for 1.1–1.3 in `packages/mixer/test/loudnessCore033.test.mjs`, `loudnessMeter033.test.mjs` and `packages/equalizer/test/analyserTapInput033.test.ts`, as positive + negative pairs (tech §4). **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: App runtime and UI (web)**, after slice 1 lands, because it consumes slice 1's APIs
  - [ ] 2.1 `website/src/repl/meter/meterSettings.ts` (tech §2.3):
    - key `strudel-loudness-meter` `{ on, target }`, sanitised;
    - the Before EQ key `strudel-eq-spectrum-pre`.

    **[Agent: strudel-web-engineer]**
  - [ ] 2.2 `website/src/repl/meter/{loudnessRuntime,useLoudness}.ts` (tech §2.3):
    - ref-counted install when audio is ready;
    - attach/re-attach to the EQ output / `destinationGain` and the limiter input;
    - the store with the snapshot, the latching warning and the 60 s history;
    - the reset rules, including the instant-switch guard;
    - wiring in `useReplContext.tsx`: install and `setPlaying(started, { switching })`.

    **[Agent: strudel-web-engineer]**
  - [ ] 2.3 `components/meter/{LoudnessStrip,WarningLight,LoudnessHistory,MeterPanel}.tsx` (tech §2.4):
    - the strip in `Header.tsx` (desktop only) and in `PerformanceStrip.tsx`;
    - the panel in `SettingsTab.tsx` after Master FX, with `id="settings-meter"`;
    - clicking the strip opens it.

    **[Agent: strudel-web-engineer]**
  - [ ] 2.4 Before EQ spectrum layer and toggle in `EqualizerUI.tsx` / `EqualizerListeningControls.tsx` (tech §2.4). **[Agent: strudel-web-engineer]**
  - [ ] 2.5 i18n: the `meter.*` keys and `eqSpectrumPre` in all 9 locales, plus `types.ts`. **[Agent: strudel-web-engineer]**
  - [ ] 2.6 Unit and component tests per tech §4 (web). **[Agent: strudel-web-engineer]**

- [ ] **Slice 3: Feature testing**
  - [ ] 3.1 Map each AC to a test or a browser check. Fill gaps with positive + negative pairs. RED-validate one guard per §2.1–2.7. **[Agent: strudel-test-engineer]**

- [ ] **Slice 4: Verify (main context)**
  - [ ] 4.1 Suites on Node 24.12 ×2 and Node 26, plus tsc, format, lint and `pnpm build:cloudflare` with the worker size.
  - [ ] 4.2 Browser measurements per tech §4, and screenshots: the header, the panel in LTR and Hebrew, the performance strip at 375 px, and the EQ with both spectrum layers.

- [ ] **Slice 5: Bookkeeping**
  - [ ] 5.1 Add a `context/product/feature-map.md` row for the Loudness meter, and a note on the EQ row about the Before EQ layer and the new taps.
  - [ ] 5.2 After prod verification: tick the roadmap, set the spec Status to Completed, and write the memory note. No migration is needed.
