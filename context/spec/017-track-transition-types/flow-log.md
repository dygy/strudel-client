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

## 2026-10-30 — web phase, browser verify, review
- Deviation: the web phase ran in the worktree before 016 landed, to keep moving (owner: "do it yourself"). Conflicts with 016 in `MixerSettings.tsx`, `Header.tsx` and `i18n/types.ts` get resolved at the rebase. The picker is hidden below `sm` until it moves into 016's compact bar.
- Browser measurements (Node + Chromium on the worktree dev server :4322 with a temporary hook; the hook is removed now). Two spec misses, both fixed by the audio agent:
  - **Held pad after a crossfade.** RMS 0.10 → **0.0000** after T+L. Fix: superdough `getActiveSoundIds` / `releaseSounds`, additive.
  - **Match loudness on a 20 dB jump.** +11 dB → **−1.0 dB**. Fix: asymmetric limits, cut 24 dB, boost 9 dB.
- Other measurements:
  - nodes stable over 10 switches (17 → 17);
  - a broken new track: the old one keeps playing at gain 1;
  - Snap 4 starts exactly on 4.000;
  - glide is linear from 30 to 35 cpm;
  - layered intro onsets go 4, 8, 12, 16.
- Build: worker 1.87 MiB. The disk was nearly full (125 MB); deleting the worktree's `dist` freed space.
- Review: `review/017-track-transition-types.md`, 4 findings, all kept. Findings 1–3 went back to the audio agent.
- Commits on the branch: `c19472c` (engine + audio), `b6e54bf` (web + superdough voice release).
- Review findings 1–3 fixed by the audio agent: incoming-track re-evaluate retargets the tempo; the Firefox release cancels pending ADSR events; Stop during evaluate applies the captured cps and is armed before `prepare`. Each RED→GREEN. Finding 4: logged here.
- Slice 7 (test engineer): 3 files, 51 acceptance tests on the real repl + Cyclist + controller, 15 RED proofs; every criterion maps to a test or a named browser-only check.
- Known gap, not fixed: `packages/mixer`'s own `vitest.config.js` can't load superdough (`AudioWorkletProcessor`). The root config, which is the gate, is fine. A follow-up would add `vite-plugin-bundle-audioworklet` as a mixer devDependency.
- Gates in the worktree (orchestrator): vitest `Test Files 67 passed (67)`, `Tests 1626 passed (1626)`; format-check clean; lint exit 0.
- Next: rebase onto main once 016 lands, move the picker into 016's compact bar, bookkeeping, push gate.

## 2026-10-30: rebase onto 016, gates, bookkeeping
- 016 landed on origin/main (037d1a1, pushed from the 016 session's branch). The local-only spec commit d52f9fb was not in origin, so the whole 017 branch (spec + 3 commits) was rebased onto origin/main.
- One conflict, in `MixerSettings.tsx`: kept 016's `usePanelViewport` and replaced the old toggle/slider with `TransitionSettingsSection`, which already sizes for touch on compact screens.
- Picker on phones: the type select is 44 px and sits in 016's compact bar next to Update (Length stays in Mixer Settings so the bar fits 390 px). The compact Update shows the waiting state. New test `CompactTransitionPicker.test.tsx`, proved red (3/3 failing) then green.
- 016's `MixerSettings-compact.test.tsx` targeted the removed toggle/slider; rewritten to check the same 44 px / desktop-class rules on the new controls.
- 016's `LoginPage-compact.test.tsx` failed in the worktree (empty first render: `useTranslation` suspends while i18n is still loading under load). Made it wait for the page to render. Not a product defect.
- Gates on the rebased branch: vitest `Test Files 80 passed (80)` / `Tests 1764 passed (1764)`; format-check clean; lint exit 0.
- `pnpm build:cloudflare` passes. `_worker.js` (a directory) totals 1,959,053 bytes, vs 1,958,113 at 016.
- Bookkeeping:
  - feature-map row updated (replaces the 009 row);
  - roadmap ticked;
  - spec Status set to Completed.

  These ship in the same push; the prod-verification note follows locally.
- Owner pre-approved the push "once 016 lands", provided all gates are green.

## 2026-10-30 — deploy run 41050595729 red, fix forward
- CI (Node 24.12, 2 vCPU) failed 3 tests in `TransitionSettingsSection.test.tsx` and `TransitionChoice-unsavedWork.test.tsx`; the deploy was skipped, so prod stayed on 016.
- Cause: the suite runs with `isolate: false`. With few workers, `settings.ts` is first loaded by an earlier file, so its persistent store is bound to that file's jsdom storage. The tests then read a different `localStorage`, and i18n's own language key also showed up.
- Reproduced locally with `--maxWorkers=2` and with 3 (all 1764 pass at 14 workers).
- Fix, tests only: `setPersistentEngine(localStorage, windowPersistentEvents)` in `beforeAll`, and the unsaved-work check compares only the settings store's keys.
- Green at 1, 2 and 3 workers under Node 22, and at default workers under Node 26; format and lint clean. No behaviour change, so per /ship step 10 the fix goes forward without a new push question.

## 2026-10-30 — deploy and prod verification
- Deploy run 41051062995 for 31e680c: "Format, lint, test" passed and "Build and deploy to Cloudflare" passed.
- Prod check: headless Chromium on https://strudel.dygy.app/embed.
  - The transition picker lists `off, dip, cut, crossfade, filterSweep, bassSwap, echoOut, layeredIntro`.
  - Selecting crossfade persists (`strudel-settingstransitionType = crossfade`).
  - No page errors.
- Not verified on prod: audible switches (the library needs login). They were measured on the dev server, see the browser-measurement entries above.
- Worktree removed; local `main` reset to origin/main. Agents dispatched: 5 (engine, audio, web, reviewer, test engineer).
- Flow defects:
  - Tech §2.3 claimed no master-gain or voice backup was needed (wrong for notes already scheduled).
  - Tech §2.8 claimed the preview has its own AudioContext (it shares one).
  - The push gate runs vitest at default workers, so it misses `isolate:false` leaks that CI's 2 workers expose.
