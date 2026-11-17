# Flow log: 033 Loudness meter and analyser

## 2026-11-17: Spec, tech and tasks
- **Inputs:** no issue; roadmap Phase 6 "Loudness meter and analyser".
- **Owner decisions (AskUserQuestion):**
  - a strip in the header and the performance view, plus a Settings panel;
  - measure after the EQ and before the speakers volume, with a pre-limiter check;
  - a pre-EQ spectrum layer behind the EQ curve;
  - Integrated resets on Play after Stop, and with a button.
- **Existing work found:** the 030 peak meter (`performance/levelMeter.ts`, kept unchanged), the 026 spectrum (`createAnalyserTap`) and the 017 RMS `LoudnessMeter`, which stays independent.
- **Produced:** `functional-spec.md`, `technical-considerations.md`, `tasks.md`.
- **Worktree:** `../strudel-client-meter`, branch `feat/loudness-meter`. Spec 033 needed no claim: no other strudel session is running.
- **Next:** dispatch the audio engineer (slice 1), then the web engineer (slice 2).

## 2026-11-17: Slice 1 (audio), done
- `packages/mixer/meter/{loudnessCore,loudnessWorklet,loudnessLoader,LoudnessMeter}.mjs` and the `AudioEqualizer` additions (`point: 'input'`, `getLimiterInput`, `onTopologyChange`), with 67 new tests.
- **The class is exported as `LufsMeter`:** the name `LoudnessMeter` is taken by spec 017's public export. Types live in `website/src/types/strudel.d.ts`, because the mixer has no `index.d.ts`.
- **Browser (Chromium) checks:**
  - zero-output keepalive works, with snapshots every 100.08 ms;
  - a −23 dBFS sine reads −22.99;
  - true peak reads +0.04 dBTP at the 45° case;
  - the output is bit-identical with the meter attached.
- **RED spot-check (main):** with the relative gate at −100, the gating test failed; with it restored, the test passed.
- **Flow defect:** a fresh worktree lacks the generated `doc.json`, so run `pnpm run pretest` first.
- **Next:** the web engineer (slice 2).

## 2026-11-17: Feature testing: AC coverage (task 3.1)
- **New tests** (test files only; no production change):
  - `website/src/repl/meter/__tests__/loudnessSetGo033.test.ts`, 6 tests. A set's Go goes through the real `evaluateNewTrack` (`keepOldOnFailure`): item transition, Off-as-Cut, the manual crossfader, and both instant fallbacks. The negative: a Go while stopped.
  - `website/src/repl/components/meter/__tests__/MeterAcceptance033.test.tsx`, 14 tests. The real `LoudnessMeterCore` feeds the real runtime, strip and panel, with a snapshot every 100 ms like the worklet.
- **Prefixes in the table:** Core = `packages/mixer/test/loudnessCore033.test.mjs`, Meter = `packages/mixer/test/loudnessMeter033.test.mjs`, Tap = `packages/equalizer/test/analyserTapInput033.test.ts`, Runtime = `website/src/repl/meter/__tests__/loudnessRuntime033.test.ts`, SetGo = `…/meter/__tests__/loudnessSetGo033.test.ts`, Settings = `…/meter/__tests__/meterSettings033.test.ts`, UI = `website/src/repl/components/meter/__tests__/Meter033.test.tsx`, Accept = `…/components/meter/__tests__/MeterAcceptance033.test.tsx`, Pre = `website/src/repl/components/panel/__tests__/EqualizerSpectrumPre033.test.tsx`.

| § | Acceptance criterion | Coverage |
|---|---|---|
| 2.1 | Speakers volume 100 % → 20 %: S changes < 0.1 LU | Browser check (main context will run). Unit side: Runtime > "EQ on: its output and its limiter input; off: the output only" (the source is the EQ output, upstream of the volume) |
| 2.1 | Only the headphone preview playing: every reading is silence | Browser check (main context will run). Unit side: Runtime > "a node on another context is never attached" (**RED ✓**) |
| 2.1 | Meter on vs off: output difference below −90 dBFS | Browser check (slice 1 measured it bit-identical). Unit side: Meter > "makes one loudness-meter-processor node: … no outputs"; Meter > "destroy removes only its own edges: the EQ output → speakers volume edge survives" + "negative: a bare disconnect() would have cut the speakers edge" |
| 2.2 | −23 dBFS 1 kHz stereo sine for 20 s: M, S, I = −23.0 ± 0.3 | Core > "a stereo 1 kHz sine at −23 dBFS for 20 s: M, S and I at −23.0 ± 0.1" (+ "negative: a −33 dBFS sine does not read −23"); Accept > "a stereo 1 kHz sine at −23 dBFS for 20 s: M, S and I each read −23.0 (strip and panel)" |
| 2.2 | Sine 20 s then silence 20 s: I = −23.0 ± 0.3, M and S show "—" | Core > "sine then 20 s of silence: I unchanged (silence gated out), M and S become null"; Accept > "20 s of the sine then 20 s of silence: I still −23.0, while M and S show "—"" (**RED ✓**) / "negative: a quiet −43 dBFS tail is not silence: M and S show it, and I stays −23 (gated)" |
| 2.2 | −23 then −43 dBFS: I = −23.0 ± 0.5 (relative gate) | Core > "−23 then −43 dBFS: the relative gate keeps I at −23 ± 0.5 (negative: ungated it would be ~−26)" (slice 1 RED); Accept > the −43 tail test above |
| 2.2 | fs/4 sine at 45°, sample peak −3.01 dBFS: TP = 0.0 ± 0.5 dBTP | Core > "fs/4 sine at 45° with sample peak −3.01 dBFS: TP 0.0 ± 0.5 dBTP" / "negative: the same sine at 0° (samples hit the peak) reads its sample peak, no overshoot" |
| 2.3 | 30 s, Stop: I keeps its value; Play: I "—" until enough is measured | Runtime > "Stop: M, S, peak and RMS silent; I, TP, LRA and counts kept; later snapshots not shown" + "Play after Stop resets the meter, the history and the warning"; Accept > "30 s, Stop: I keeps its value and M/S show "—"; Play: I is "—" until enough is measured" |
| 2.3 | A set's Go: I keeps accumulating | SetGo > all 6 (item Crossfade, Off-as-Cut, manual crossfader, transition throws → instant, no controller → instant) (**RED ✓**) / "negative: a Go while the speakers are stopped is a Play after Stop, so it resets"; Runtime > "the instant switch (spec 017) stops and restarts the scheduler without resetting Integrated" / "negative: the same stop/start read without the switching flag would reset" |
| 2.3 | Reset while playing: I, TP, counts and history clear; measuring continues | Core > "reset() clears I, TP, LRA, peaks, events and the measured time; measuring continues"; Runtime > "Reset clears everything while measuring continues, and drops a snapshot from before it"; UI > "Reset resets the meter; the switch turns the meter off (readings gone) and on" |
| 2.3 | Update while playing: I isn't cleared | Runtime > "Update while playing hot-swaps without a toggle, so nothing resets" / "negative: Stop then Play through the same harness does reset"; Accept > "Update while playing (no toggle) leaves I accumulating across the new code" |
| 2.4 | EQ on, pushed into the limiter: lit, "Limiter working" +1 per event | Core > "limiter: a pre-limiter sample at exactly −0.3 dBFS (float32) counts" / "negative: … one float32 step under −0.3 dBFS counts nothing"; Core > "an event that lasts counts once; a gap of 0.5 s or more starts a new one"; Accept > "EQ pushed into its limiter: the "Limiter working" count rises by 1 per event, not per sample". The real limiter path: browser check |
| 2.4 | EQ off, a sample at 0 dBFS: lit with "Clipping" | Core > "clip: a post-EQ sample at 0 dBFS counts while there is no pre-limiter input"; Meter > "absent input 1: a post-EQ sample at 0 dBFS is "clip"; present input 1: it is not"; Accept > "EQ off (no pre-limiter input) and a sample at 0 dBFS: lit with "Clipping"" / "negative: with the EQ on (a pre-limiter input under its ceiling), 0 dBFS out is not "Clipping"" (**RED ✓**) |
| 2.4 | TP −0.5 dBTP, sample peaks < −1 dBFS: lit with "True peak over −1 dBTP" | Core > "truePeak: a true peak of −0.5 dBTP with sample peaks below −1 dBFS counts"; Accept > "a true peak of −0.5 dBTP with sample peaks below −1 dBFS lights it with "True peak over −1 dBTP"" |
| 2.4 | A mix peaking at −3 dBTP: the warning stays off | Core > "negative: a mix peaking at −3 dBTP counts nothing"; Accept > "negative: a mix peaking at −3 dBTP keeps the warning off, with every count at 0" |
| 2.4 | Click the lit warning: off, counts stay until Reset | Runtime > "lights when a count rises, names the reasons, stays lit until cleared; counts stay"; UI > "lit with the reasons and counts; click clears it; the counts stay until Reset" / "negative: clicking a dark light does nothing" |
| 2.5 | Desktop header shows S, matching the panel | UI > "target −14: S −10 is amber, −14.5 neutral, −21 dimmed; the number matches the panel" + "the desktop header shows the strip" / "the compact (phone) layout shows no strip in the header, embedded or not" |
| 2.5 | Performance view at 375 px: strip and peak bars visible, no horizontal scroll | Browser check (main context will run). jsdom has no layout |
| 2.5 | Target −14: S −10 amber, −14.5 neutral (dimmed, target Off) | UI > "target −14: S −10 is amber, −14.5 neutral, −21 dimmed; …" (also covers target Off → neutral, no mark) (**RED ✓**); Settings > "target −14: S at −10 is amber, at −14.5 neutral, at −20.5 dimmed" (with the exact +2 and −6 edges) / "target off, or no reading: always neutral" |
| 2.6 | 60 s of play: history shows 60 s of S and M; stops scrolling after Stop | Runtime > "keeps the last 600 entries (60 s at 10 Hz)" + "Stop: … later snapshots not shown"; Accept > "60 s of play: S and M span the whole graph; after Stop it stops scrolling (no redraw, no new entry)" (**RED ✓**) / "negative: 10 s of play fills only the right sixth of the graph" |
| 2.6 | Target −23 survives a reload | UI > "the target is remembered: −23, then a reload still shows −23"; Runtime > "the target is remembered, sanitised"; Settings > the sanitising cases |
| 2.6 | Meter off: no strip in header or performance view; no work while playing | UI > "hidden while the meter is off; back when on" (the same `LoudnessStrip` is mounted in both places); Runtime > "off destroys the meter and clears the readings; on installs a new one" + "nothing is created while the meter is off" + "off while the meter is still being created destroys it when it arrives". The worklet node count: browser check |
| 2.6 | −20 dBFS stereo sine: RMS bars −23 ± 0.5, peak bars −20 ± 0.5 | Core > "a stereo 1 kHz sine at −20 dBFS: RMS −23 ± 0.5, peak −20 ± 0.5 on both channels" / "negative: 400 ms after a loud burst the 300 ms window has forgotten it"; Accept > "a stereo 1 kHz sine at −20 dBFS: both bars read peak −20.0 and RMS −23.0 dBFS" / "negative: after Stop the bars show no stale level" |
| 2.7 | +12 dB on the 125 Hz band, noise: after ≈ before + 12 dB (±3) at 125 Hz, ±2 dB at 2 kHz | Browser check (main context will run). The mock graph runs no DSP. Unit side: Tap > "connects the analyser from the EQ input, not the output" |
| 2.7 | EQ off: layers match within ±1 dB, 50 Hz–15 kHz | Browser check (main context will run) |
| 2.7 | Before EQ off: only the 026 spectrum, no before-EQ measurement | Pre > "off by default: only the 026 tap, no before-EQ measurement" (**RED ✓**) / "on: a second tap on the EQ input, …; off disconnects it; remembered" + "negative: Spectrum off disables Before EQ and disconnects both taps" + "not while stopped; …" |

- **RED validation:** one guard per section. Each mutation was made with a `mktemp` backup and restored with a sha256 match.

  | § | Production line mutated | Test that went red | Failure |
  |---|---|---|---|
  | 2.1 | `loudnessRuntime.ts` `sameContext` → `!!node` | Runtime > "a node on another context is never attached" | `expected { …(2) } to deeply equal { postEq: null, preLimiter: null }` |
  | 2.2 | `loudnessCore.mjs` `powerToLufs` without the zero and absolute-gate checks | Accept > "20 s of the sine then 20 s of silence: … M and S show "—"" | `expected '-300.7' to be '—'` |
  | 2.3 | `loudnessRuntime.ts` `if (!stoppedBySwitch) resetMeasurement()` → always reset | SetGo > both instant-fallback Go tests | `expected "spy" to not be called at all, but actually been called 1 times` |
  | 2.4 | `loudnessCore.mjs` clip check without `!pre &&` | Accept > "negative: with the EQ on …, 0 dBFS out is not "Clipping"" | `expected 1 to be +0` |
  | 2.5 | `loudnessFormat.ts` `shortTermTone` without the `typeof target` check | UI > "target −14: S −10 is amber, …" | `expected 'quiet' to be 'neutral'` |
  | 2.6 | `loudnessRuntime.ts` `if (!playing) return; // frozen while stopped` removed | Accept > "60 s of play: … after Stop it stops scrolling" | `expected [ { t: 1089.56…}, …(599) ] to be [ { t: 1062.47…}, …(599) ]` |
  | 2.7 | `EqualizerUI.tsx` `spectrumPreActive = spectrumActive && spectrumPreOn` → `spectrumActive` | Pre > "off by default: only the 026 tap, no before-EQ measurement" | `expected [ { connections: [], …(14) } ] to have a length of +0 but got 1` |

- **Implementation gaps:** none found.
- **Suites:**
  - `pnpm exec vitest run` (Node 26): 288 files / 5659 tests passed.
  - `npx -y node@24.12.0 node_modules/vitest/vitest.mjs run --maxWorkers=2`: 288 / 5659 passed.
  - `pnpm run format-check` and `pnpm run lint` are clean.
  - `known-red-tests.txt` is unchanged (still empty).
- **Next:** slice 4. The main context runs the browser checks listed above.

## 2026-11-17: Slice 2 (web) done, plus browser verification in the main context
- **Web (agent):** `website/src/repl/meter/*`, `components/meter/*`, the strip in the Header and Performance views, the Settings → Meter panel, the Before EQ layer, 31 i18n keys in 9 locales, and 82 tests.
  - **Instant-switch trap:** `isSmoothTransitioningRef` is true only during the synchronous `repl.stop()`. So `setPlaying` is called from `onToggle`, not from a `useEffect` on `started`.
  - **Agent's browser checks (Chromium):**
    - −23 dBFS gives M/S/I −22.99;
    - speakers volume at 20 % moves S by less than 0.01;
    - EQ +6 dB with a −6 dBFS sine gives limiter 1 / truePeak 1 and the light; clicking clears it;
    - the 375 px strip fits (right edge 362 px);
    - in Hebrew the panel mirrors and the numbers stay LTR;
    - the /embed REPL reads S −25.9 while playing and "—" after Stop.
- **Main-context browser checks (dev server on 4330, /embed):**
  - **§2.7 EQ off:** post − pre within ±0.6 dB at 50 Hz–15 kHz (pass, criterion ±1).
  - **§2.7 +12 dB:** with +12 dB on the 125 Hz band, the difference is +11.52 dB at 125 Hz (pass, ±3) and −1.12 dB at 2 kHz (pass, ±2). The criterion was amended from 100 Hz to 125 Hz, because there is no 100 Hz band.
  - **§2.6 meter off:** 5 on/off cycles gave 5 worklet nodes, 10 edges into them, 10 explicit disconnects and no bare `disconnect()` (pass).
  - **§2.1 output identical:** the audio agent's offline render was bit-identical with the meter attached (max diff 0).
  - **§2.1 headphones:** not measurable in the browser. By construction the preview engine is a separate AudioContext, and the meter attaches only to main-context nodes (`sameContext` guard, tested).
- **Screenshots:** `/private/tmp/claude-501/-Users-arkadiishvartcman-WebstormProjects-strudel-client/2de1382d-27cd-4ec7-926c-a1d7a0fa8262/scratchpad/033-evidence/`.
- **Noticed:** reading labels in the narrow panel are truncated ("Momentary (40…"). This goes to review.
- **Next:** the reviewer.
