# Flow log — 020 strong EQ control

## 2026-11-12 — spec, tech, tasks
- No GitHub issue; owner request in chat after the 008 fix (ada694c).
- `/awos:spec`: functional-spec.md. Owner chose: 24 dB/oct cuts; limiter + output level; the 12 genre presets as listed. Status Approved.
- `/awos:tech`: drafted inline (the area was already read in the 008 fix this session; no Explore or specialist consult, to save agents; flow deviation). Owner approved.
- `/awos:tasks`: tasks.md written inline: 6 slices, audio owner plus one test-engineer slice.
- Next: Step 5, one `strudel-audio-engineer` dispatch (slices 1–4).

## 2026-11-13 — implementation (slices 1–4)
- 1 `strudel-audio-engineer` dispatch. Uncommitted.
- Main-session RED proof: source at HEAD with the new tests gives `Tests 18 failed | 1 passed (19)`; restored gives `107 passed (107)`.
- Divergences from the tech spec, measured by the implementer:
  - Butterworth Q is set in dB (−5.34 / +2.33), because Web Audio reads it in dB.
  - The low cut rests at 10 Hz when off: at 0 Hz a toggle threw a 9–16 dB transient.
  - The limiter has a makeup trim plus a soft clipper (ceiling 0.98): the compressor alone peaked at +1.3 dBFS.
  - The dry path is delayed 6 ms to match the lookahead, so there is no comb on toggle. Both outputs gain 6 ms of latency.
  - Glides are asymmetric (they fixed bass bumps of +4.4 and +2.6 dB).
  - Above 2 channels each stereo pair gets its own limiter.
  - The wet chain rests flat while off.
- Browser (Chromium, real modules):
  - low cut 200 Hz takes 100 Hz down 24.1 dB; high cut 2 kHz takes 4 kHz down 24.7 dB;
  - +24 dB on loud noise peaks at −0.30 dBFS;
  - flat on vs off differs by 0.000 dB;
  - no step on toggle or on 9 preset switches; no zipper on a sweep.
- Bugs found while measuring and fixed: the low-cut transient; rAF "Illegal invocation" in the limiter indicator.
- Genre preset loudness vs Flat, measured: −0.88…+2.00 dB, within ±3.
- Gates (implementer): 176/176 files, 3641 tests; Node 24.12 with 2 workers; shuffle seeds 1 and 4; format, lint and build:cloudflare clean.
- Screenshots: docs/screenshots/020-eq-desktop.png and 020-eq-compact.png.
- Next: slice 5 (test engineer) and the review, both in parallel.

## 2026-11-13 — feature testing and review
- Slice 5: 1 `strudel-test-engineer` dispatch added 68 tests in 3 new files (`panel/__tests__/{EqualizerAcceptance020,SettingsTab-eq020}.test.tsx`, `i18n/__tests__/equalizerStrongControlKeys.test.ts`). Each test was RED under a named production mutation (29 mutations). It found no production bugs. Suite on Node 24.12 with 2 workers: 179/179 files, 3709 tests.
- Every acceptance criterion maps to a test; the criteria that need audio are browser-measured (tech §4).
- Flow defect: `--maxWorkers=2` alone fails on vitest 3.0.4 (minThreads/maxThreads conflict). Use `--minWorkers=1 --maxWorkers=2`.
- Review: 1 `strudel-reviewer`, 2 Major and 4 Minor findings, no blockers. The owner's decisions:
  - The limiter acts on flat loud audio: fix it, with the threshold raised to about 0 dBFS (≤ −0.5 dBFS passes unchanged).
  - The 6 ms latency: keep the dry delay, add 6 ms to the default MIDI latency, document the `.dough()` offset.
  - The Limiting indicator stuck on an EQ swap: fix.
  - The 6 ms jump on an insert swap mid-playback: fix (click-free swap).
  - The multichannel limiter layout is fixed at build time: fix.
  - The feature map: done in main (slice 6).
- Fixes go to the same audio engineer.

## 2026-11-13 — review fixes, verify, commit
- The same audio engineer fixed the review findings:
  - limiter threshold −0.3 dB and clipper transparent to −0.3 dBFS (flat at −0.5 dBFS peak passes unchanged, 0.0000 dB); +24 dB boosts peak at −0.009 dBFS;
  - MIDI default latency 34→40 ms (`packages/midi/midi.mjs`, `packages/desktopbridge/midibridge.mjs`, docs); the `.dough()` bypass is documented;
  - the indicator resets on an EQ swap;
  - click-free insert swap through switch gains after destinationGain (largest step 0.0144 vs 0.4853 before; a short dip at install);
  - `setChannelCount` rebuilds the limiter stage when superdough's output reset changes the channel count.
- Each fix proven red→green by the specialist.
- Divergence kept: the 10 Hz resting highpass (it prevents a toggle transient) costs −0.0007 dB and phase rotation below about 60 Hz on real material.
- Main-session gates:
  - Node 24.12 with 2 workers: 178 files pass; `packages/mcp-worker/test/budget.test.ts` wall-clock fails locally under load (load avg about 9). It is skipped on CI (`skipIf(process.env.CI)`); with `CI=true`, 178 passed and 1 skipped. The MCP worker is untouched.
  - format and lint clean; build:cloudflare passes (specialist).
- Acceptance coverage: every criterion in §2.1–2.7 maps to a test (test-engineer table); the criteria that need audio are browser-measured (above and in the implementation entry).
- No second review of the fix round (the fixes are test-guarded; to save an agent).
- Agents: audio engineer 1 (3 rounds), test engineer 1, reviewer 1.

## 2026-11-13 — delivered: 1160b56 on prod
- The push gate passed with no bypass. CI / Deploy run 43348888453 succeeded (Format, lint, test; Build and deploy to Cloudflare).
- Prod check (Chrome, logged-in owner): the served bundle contains `setChannelCount`, `getLimiterReduction`, `onChannelCount` and `driftPhonk`. The panel shows "10-band parametric EQ with low/high cut and 34 presets". The owner's pre-020 save ("Bass Reducer") loaded as before, which covers AC 2.6.2 on prod. No console errors. Audio was not played on prod; the audible checks are the Chromium measurements above.
- Bookkeeping: roadmap ticked, spec Completed, feature map updated (1160b56), memory `eq-strong-control-020` written and `eq-off-must-be-silent` ranges updated.
- Agents this run: 3 (audio engineer, test engineer, reviewer).
- Flow defects:
  - `/awos:tech` was drafted inline instead of through Explore and a specialist;
  - `--maxWorkers=2` needs `--minWorkers=1` on vitest 3.0.4;
  - the local mcp-worker budget test is load-sensitive.
