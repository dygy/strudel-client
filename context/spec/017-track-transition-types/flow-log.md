# Flow log — 017 track transition types

## 2026-10-30 — gather + workspace
- Origin: research session on automatic track mixing (no GitHub issue). Research established a pattern-level approach (repl `editPattern` hook, `stack(old, new.late(T))`, `filterHaps` for snapping, `velocity` scaling, hap `cps` for tempo); handed to /awos:tech.
- Workspace NOT clean: another session is implementing spec 016 in this tree (27 files, incl. `panel/MixerSettings.tsx` and the i18n locales). Owner decision (AskUserQuestion): **spec now, code later**. Write spec/tech/tasks in this dir only and commit only this dir; start implementation after 016 has landed and the tree is clean.

## 2026-10-30 — spec
- Produced `functional-spec.md`: 8 types (Off, Dip, Cut, Crossfade, Filter sweep, Bass swap, Echo-out, Layered intro), Length in cycles, 3 modifiers (Snap to, Tempo glide, Match loudness), a picker next to Update.
- Owner decisions (AskUserQuestion):
  - length in cycles for all types (1/2/4/8/16, default 4);
  - Mixer Settings plus a quick picker next to Update;
  - another switch mid-transition: finish, then go to the latest;
  - defaults Off with modifiers off; existing smooth-on users get Dip.
- Orchestrator decisions (no question asked):
  - a new track with an error leaves the old track playing;
  - Cut waits for at least the next cycle;
  - Tempo glide off means the new tempo from the start of the overlap;
  - match loudness within 3 dB.
- Next: /awos:tech.

## 2026-10-30 — tech
- Owner said "continue", taken as spec approval.
- Produced `technical-considerations.md`. It was drafted inline, not via Explore or specialist agents: the area was already read in this session (core repl/cyclist, superdough, mixer, useReplContext). Flow deviation from /awos:tech, per CLAUDE.md "work inline by default".
- Key decisions:
  - every type except Off is pattern-level, through the `editPattern` hook;
  - the new `TrackTransitionController` replaces `SmoothTransitionManager`;
  - a track origin offset is used instead of stop/restart;
  - `setcps` is captured during evaluate;
  - old events are truncated, plus `clip`;
  - echo uses a dedicated orbit 15;
  - the loudness trim is a velocity multiplier;
  - one additive upstream change: `state.layers` in core repl.
- Spec amended: the loudness criterion now says "from 2 cycles after the transition ends" (it can't be measured during the overlap).
- Next: tech gate, then /awos:tasks.

## 2026-10-30 — tech gate + tasks
- Tech approved by the owner (AskUserQuestion), including deleting `SmoothTransitionManager`.
- Produced `tasks.md` (8 slices; areas: web 1/2.4/6, audio 2–5, engine 4.1). The owner reviewed it ("looks good"), so the not-user-reviewed marker is removed.
- Committed the spec dir only.
- **Paused:** implementation (Step 5) starts once spec 016 has landed on `main` and the tree is clean. Resume with `/ship 017-track-transition-types`.

## 2026-10-30 — implement: engine + audio (worktree)
- Owner: "сам это делай" ("just do it yourself"). So: disjoint engine and audio work now, in worktree `../strudel-client-017` on branch `feat/017-transition-types`; the web phase waits for 016 to land (background watcher on the main tree).
- Engine agent, task 4.1:
  - `state.layers` in `packages/core/repl.mjs`. Additive, marked as a fork addition, so the upstream divergence is recorded here.
  - 7 tests, RED→GREEN.
- Audio agent, tasks 2.1, 2.2, 2.5, 3.1, 3.2, 4.2, 5.1–5.3:
  - New: `TrackTransitionController.mjs` and `transitions/{buildTransition,envelopes,loudness}.mjs`.
  - Tests: 45 + 51 + 19, 7 RED proofs.
  - `SmoothTransitionManager` is kept until the web phase (task 2.3 deletion is deferred).
- Accepted deviations from the tech spec, all of them driven by the functional spec:
  - envelopes are sampled at the middle of each note;
  - with Snap off, T rounds up to the next quarter cycle (the beat);
  - Bass swap fades the new track in over the first half;
  - Echo-out sends only the last cycle before T to the echo;
  - `oldPat` comes from `scheduler.pattern`;
  - visuals are cleaned at evaluate, as today;
  - the controller accepts Off as a 1/16-cycle cut for queued switches;
  - loudness measures the old track from the switch press;
  - Length ties go to the shorter value;
  - Layered intro falls back to crossfade when the code contains `all(` or `each(` (regex).
- Open for browser verification: short un-clipped samples ringing past T+L; `.cpm()` against the old tempo during evaluate; `setGainCurve` bending the fades.
- Verified by the orchestrator: full suite in the worktree, `Test Files 61 passed (61)`, `Tests 1526 passed (1526)`.
- Next: when 016 lands, rebase the branch onto main, then the web phase (slices 1, 2.3, 2.4, 6) plus the browser verifies.
