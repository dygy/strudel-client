# Flow log — 032 Master FX

## 2026-11-16 — Gather + specs
- No issue. Roadmap Phase 6 "Master FX". Peer (strudel-client-4a) confirmed 032 is free; noted `feat/master-bus-glide` (upstream sync + code-controlled master compressor — no overlap), the existing scratch brake, and a suspected supradough-after-reset bug (test added to tech §2.1).
- Owner choices (AskUserQuestion): FX before EQ and in recordings; brake through the scratch deck; hold-to-act; panel + performance row.
- Produced functional-spec.md, technical-considerations.md (tech gate: self-review, all sections; no data/runtime/secret impact), tasks.md.
- Worktree `../strudel-client-masterfx`, branch `feat/master-fx` from origin/main 1550577.
- Next: implement — audio (slices 1–3) first, then web (slice 4).

## 2026-11-16 — Implement (slices 1–4)
- Audio agent: superdough `setMasterInsert` (+ supradough-after-reset bug confirmed and fixed via `connectToDestination(..., { keep })`), `packages/mixer/masterfx/*` (MasterFx, filterCurve, beatRepeatCore/Worklet/Loader, settings), midiMap `hold` kind. OfflineAudioContext measurements in its report (rest −144 dBFS, filter −32.8/−72.1 dB, delay 0.378 s spacing, roll exact, no node leak).
- Web agent (in parallel, disjoint files, adapter `masterFxEngine.ts`): scratchRuntime `brake`, masterFxRuntime + rollGrid, MIDI group masterFx, FilterKnob/HoldButton/MasterFxPanel/MasterFxRow, 9 locales.
- Main spot-check: vitest 274 files / 5459 tests green, tsc 0, format + lint clean. RED: `preGainTarget()` forced to destinationGain → 5 failures; restored → 15/15.
- Next: Feature testing (test engineer) ∥ browser verify (main).

## 2026-11-16 — Browser verify (main, dev server :4337, signed out)
- Real app via /embed (no login needed; the FX are installed by useReplContext): `masterFxRuntime.getFx()` present, worklet `ready` true, ctx 48 kHz running.
- Filter, measured at the main EQ output tap (proves fx → destinationGain → EQ wiring): 1 kHz −32.7 dB at LP −100; 100 Hz −72.0 dB at HP +100; passing side 100 Hz +2.9 dB (LP), 10 kHz +2.1 dB (HP) — resonance boost, AC "< 3 dB cut" met.
- Delay throw (cps 0.5, 3/16): echoes at 0.27, 0.63, 1.03, 1.40, 1.78, 2.16 s (10 ms windows ≈ 0.375 s), ratios 0.70 (level), then 0.55/0.56/0.55 (feedback).
- Stop with a 6 s reverb tail: below −60 dB 0.095 s after Stop (marker-calibrated); −124 dB at 0.15 s; stays silent after the 0.25 s line swap.
- Beat-repeat on a live 8-note pattern (1/4 cycle = 0.5 s): consecutive 0.5 s periods identical (−∞ dB difference) while held; +3 dB (not periodic) before and after. Grid phase not observable on a periodic signal; covered by rollGrid unit tests.
- Brake: −26 dB → silence over ~0.5 s, silent while held, back on release; the held store lit.
- UI via a temporary harness page (deleted): perf row at 375 px wraps, scrollWidth 375 = clientWidth; Hebrew mirrors, filter row LTR, click at 20 % from left → LP 87 %, panel knob in sync, dblclick → 0; mouse hold lights Delay in strip and panel, release unlights; settings persisted across reloads.
- Not checked in a browser: MIDI hold through the WebMidi stub (MIDI panel is not in /embed; covered by midiMapHold032 + midiTargetsMasterFx032).
- Screenshots: scratchpad 032-evidence/032-en-375.png, 032-he-375-lp.png, 032-he-375-held.png.
- Next: feature testing result, review.

## 2026-11-16 — Feature testing
- Test engineer: AC table complete; 3 new files (masterFxRouting032, midiMasterFxLive032, masterFxReplWiring032), 26 tests; RED→GREEN per §2.1–2.8 (16 mutations). No bugs. Suite 277 files / 5483 tests on Node 26 and Node 24.12 ×2.
- §2.1 rest < −90 dBFS: covered by the audio agent's OfflineAudioContext measurement (max diff 6e-8 ≈ −144 dBFS), not re-measured live.
- Next: review.

## 2026-11-16 — Review + fixes
- strudel-reviewer: 1 Major + 3 Minor (review/032-master-fx.md). Owner: fix all.
  - #1 Major roll grid ~50 ms late (Cyclist.now() is the cycle at t − clock.duration) → `audible = now() + (duration − latency)·cps`; NeoCyclist has no clock → 0 (correct there). Cyclist-model test red→green.
  - #2 All FX off now resets the filter's MIDI pickup (`watchFilterPickup`, source-tagged setFilter). Negative test red→green.
  - #3 HoldButton forgets its pointer/key ids when the effect drops (blur/hidden/All off/Stop). Tests red→green.
  - #4 feature-map row added.
  - Extras: web settings re-export the mixer's constants (one source); strudel.d.ts completed.
- Follow-up noticed (not 032): TrackTransitionController's `currentTime + (T − now)/cps + latency` and its loudness stamp are ~one clock duration (50 ms) late by the same model (specs 017/027).
- Gates (main): vitest 278 files / 5492 tests; tsc 0; format + lint clean; build:cloudflare exit 0, `_worker.js` 2.7M, beat-repeat worklet inlined in `_astro/Repl.*.js`.
- Next: commit, push gate.
