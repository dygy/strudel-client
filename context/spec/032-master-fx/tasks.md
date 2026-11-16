# Tasks: Master FX (032)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

- [ ] **Slice 1: superdough master insert (audio)**
  - [ ] 1.1 `packages/superdough/superdoughoutput.mjs`: `setMasterInsert(node, { output, onChannelCount })` / `getMasterInsert()`; `preGainTarget()` for the scratch/merger far end and `directInputs`; kept across `reset()`; `null` restores the 019 graph; JSDoc + `@noAutocomplete`; reachable through the controller like `setPreGainInsert` (tech §2.1). **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 Tests: wiring with and without scratch insert, direct inputs into the insert, reset re-wire + `onChannelCount`, removal restores the old edges, supradough source reaches the new `destinationGain` after `resetGlobalEffects()` (fix if not) (tech §2.1). **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: MasterFx stage (audio)**
  - [ ] 2.1 `packages/mixer/masterfx/filterCurve.mjs` (pure) + filter stage with dry/wet crossfade and dead zone (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [ ] 2.2 Delay and reverb throws: tempo-synced delay, generated IR with crossfaded convolver swap, 10 ms send ramps, `stopTails()` (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [ ] 2.3 `masterfx/beatRepeatCore.mjs` (pure) + `beatRepeatWorklet.mjs` (N channels, 8 s ring, frame counter, roll/length/stop, 3 ms crossfades), loaded via the scratch worklet loader pattern; pass-through until loaded; `setChannelCount` rebuild (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [ ] 2.4 `MasterFx.mjs` assembling 2.1–2.3, `destroy()` disconnects everything; exports + types from `packages/mixer/index.mjs` / `index.d.ts`; README section (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [ ] 2.5 Tests for 2.1–2.4 in `packages/mixer/test/` (positive + negative pairs) (tech §4). **[Agent: strudel-audio-engineer]**

- [ ] **Slice 3: MIDI hold kind (audio)**
  - [ ] 3.1 `packages/mixer/midi/midiMap.mjs`: `'hold'` kind (`down`/`up`), note and CC edges, learn like a button, auto-`up` on clear/replace/import/dispose/disconnect; 031 exports still import (tech §2.3). **[Agent: strudel-audio-engineer]**
  - [ ] 3.2 Tests for 3.1; 031 map tests unchanged and green. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 4: App wiring and UI (web)** — after slices 1–3 land (consumes their APIs)
  - [ ] 4.1 `website/src/repl/scratch/scratchRuntime.ts`: `'brake'` source + `brake(down)` on the main deck regardless of `selected`, refused while held by another source (tech §2.4). **[Agent: strudel-web-engineer]**
  - [ ] 4.2 `website/src/repl/masterFx/masterFxRuntime.ts` + `rollGrid.ts`: ref-counted install when audio is ready, settings store `strudel-master-fx` (sanitised), non-persisted filter atom, holds with auto-release (blur/hidden), All FX off, Stop hook → `stopTails`, cps follow, roll grid from the Snap tempo source with latency correction (tech §2.5). **[Agent: strudel-web-engineer]**
  - [ ] 4.3 `website/src/repl/midi/midiTargetMeta.ts` + `midiTargets.ts`: group `masterFx` (filter with centre detent, four holds, repeat length) (tech §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 4.4 `components/masterfx/{FilterKnob,HoldButton,MasterFxPanel,MasterFxRow}.tsx`; panel in `SettingsTab.tsx` after Mixer settings; row in `PerformanceStrip.tsx`; brake note links to the scratch feel sliders (tech §2.7). **[Agent: strudel-web-engineer]**
  - [ ] 4.5 i18n: `masterFx.*` + MIDI row labels in all 9 locales + types. **[Agent: strudel-web-engineer]**
  - [ ] 4.6 Component/unit tests per tech §4 (web). **[Agent: strudel-web-engineer]**

- [ ] **Slice 5: Feature testing**
  - [ ] 5.1 AC → test/browser-check table; gaps filled with positive + negative pairs; RED-validate one guard per §2.1–2.7. **[Agent: strudel-test-engineer]**

- [ ] **Slice 6: Verify (main context)**
  - [ ] 6.1 Suites (Node 24.12 ×2 and Node 26), tsc, format, lint, `pnpm build:cloudflare` (worklet asset emitted) + worker size.
  - [ ] 6.2 Browser measurements per tech §4 + screenshots (panel LTR/Hebrew, perf row at 375 px).

- [ ] **Slice 7: Bookkeeping**
  - [ ] 7.1 `context/product/feature-map.md` row (Master FX); scratch row note on the brake source; MIDI row note on the hold kind.
  - [ ] 7.2 Roadmap tick, spec Status Completed after prod verification, memory note. No migration.
