# Flow log — 023 vinyl scratch realism

## 2026-11-13 — spec, tech, tasks
- The owner's feedback on 019: no inertia, the sound doesn't follow the hand, the track doesn't move after release. The owner chose "like vinyl, with quantize".
- Root causes, verified by reading `scratchDsp.mjs`:
  - `grab()` freezes the ring and pins position 0 to the grab moment, so a forward push is clamped and silent;
  - the 10 ms mix gives no brake or spin-up;
  - release crossfades back to the unshifted live input.
- Spec, tech and tasks were written inline. Number 022 was taken by another session's `set-playlist` (6cc8e17 on local main, not pushed).
- Next: one `strudel-audio-engineer` dispatch (slices 1–3), in parallel with spec 021's engineer (disjoint files).

## 2026-11-13 — implementation (slices 1–3)
- 1 `strudel-audio-engineer` dispatch. The 019 author's traps were forwarded mid-run.
  - Core and superdough are untouched; `useReplContext` has 2 hunks: editPattern via `scratchRuntime.editMainPattern`, and `setMainRepl`.
- Design:
  - the ring is always written;
  - `scratchPhysics.mjs` holds the brake (0.1 s raised cosine) and the spin-up (0.4 s);
  - snap is planned in the DSP at release (spin-up stretched 0.2–0.8 s, correction rate 0.5–1.1);
  - a lag under 0.05 s becomes 0 and is caught up with no shift;
  - `ScratchHandOver`: snapshot and fade the old voices, `PatternOffset.shift` (composed after the 017 editPattern, identity at 0), a sample-accurate crossfade at S + 5 ms;
  - the offset is dropped on a switch, reset on stop and kept on a same-track Update;
  - a speakers grab is blocked during a 017 transition (the platter is dimmed);
  - `releaseAll` cancels pending releases.
- Main-session RED proof: with the old `scratchDsp.mjs`, `Tests 16 failed | 3 passed (19)`, including "a forward push right after the grab is heard"; restored: `19 passed`.
- Main-session suite: Node 24.12, 2 workers, 189/189 files, 4035 tests; format and lint clean. The implementer reports build:cloudflare passing.
- Browser (Chromium, real modules):
  - 2-beat hold → +2.000 beats;
  - 1.8-beat hold with snap on → 2.000, snap off → 1.804;
  - brake 67.8 ms; spin-up 276 ms (5–95%);
  - hand-over step 0.0133 vs 0.0408 steady;
  - forward push RMS 0.0201 vs 0 while held;
  - offline hand-over lag exactly 1.000000 s.
- Next: feature testing and review, both in parallel.

## 2026-11-13 — feature testing and review
- Feature testing: 1 `strudel-test-engineer` dispatch.
  - New files: `packages/mixer/test/scratchAcceptance023.test.mjs` (11 tests) and `website/src/repl/__tests__/scratchAcceptance023.test.ts` (5 tests). RED under 13 mutations.
  - Suite: 191/191 files, 4051 tests.
  - All 15 acceptance criteria are mapped. §2.2.2 (the slow-and-low feel) and §2.3.2 with real patterns are browser-measured.
- Spec amended: the §2.4 criteria now read "fallen ~1.8 beats behind", because the lag includes the brake and the spin-up (see the Change Log).
- Review: 1 `strudel-reviewer`, 1 Major and 6 Minor findings. The owner's decisions:
  - Major, long notes cut at the hand-over: **restart long notes** mid-note at the hand-over.
  - Accepted: the platter follows the stretched spin-up; the correction gets proportional depth instead of an octave dip; an Update during spin-up keeps the planned shift; sync-mode hand-over timing; an immediate grab right after settling.
  - The feature map is done in the main session.
- All fixes went back to the same audio engineer.

## 2026-11-13 — fix round 1 and re-review
- The same audio engineer fixed the review findings:
  - the long-note restart at S (synths keep their envelope; samples start at a later `begin`);
  - the platter follows the posted release plan;
  - the correction has a 0.7 s minimum, so its depth scales with the error;
  - Update keeps the planned lag (`commitPending`);
  - NeoCyclist arrival found through a one-shot query probe;
  - an immediate re-grab across the splice.
- Browser:
  - a pad after the hand-over is −0.01 dB (it was −180 dB silence); a `loopAt` loop is +2.2 dB;
  - the platter tracks the sound's rate within 0.012;
  - a push 43 ms after settling is heard.
- Main-session suite: 193/193 files, 4076 tests; format and lint clean.
- Re-review: the same `strudel-reviewer`, 4 Minor findings: ghost samples after their decay, a synth overshoot of +4.4 dB, the 8 s edge after the splice playing forwards, and a flam when Update lands during spin-up. The owner accepted all 4, and they went to the same engineer.

## 2026-11-13 — fix round 2, then commit
- Same engineer fixed all 4:
  - restarted samples follow their elapsed envelope, and notes that have died away are skipped; restarts play through a hidden `_scratchrestart` sound;
  - the fade-in goes to the current level with no overshoot, with phase alignment for steady stock waveforms;
  - the 8 s edge is checked on the real read lag;
  - an Update during spin-up schedules the shift at the planned landing (using the 017 `endAt`/`fromOrigin` exports), so there is no flam.
- **superdough fork change:** `releaseSoundHandle` adds `setTargetAtTime(0, startTime, …)` after `cancelAndHoldAtTime`. Chromium was fading released voices from the moment of the call, so spec 017 transitions were also fading old voices early. Raised with the owner at the push gate.
- Browser (real-time):
  - no ghost (−63.6 dB where the original is silent);
  - pads after the hand-over within 0.02 dB of the unscratched track;
  - an Update 0.1 s after release gives a 0.46 dB RMS step against 12 dB on steady material, and the offset is kept.
- Suite (implementer): 194/194 files, 4093 tests; format, lint and build clean.
