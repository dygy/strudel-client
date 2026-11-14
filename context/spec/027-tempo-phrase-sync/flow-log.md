# Flow log — 027 tempo-phrase-sync

## 2026-11-14 — spec, tech, tasks
- Roadmap Phase 6 item "Tempo and phrase sync"; no GitHub issue.
- Found while gathering: 017 already has Snap (0/1/4/8, counted from the scheduler's cycle 0) and a Tempo glide checkbox (glide during the overlap; off = the old track jumps to the new tempo at T). So 027 extends both instead of adding a new system.
- Owner decisions (AskUserQuestion):
  - a 4-way Tempo choice (Jump / Glide during / Match, then glide / Keep set tempo) replaces the checkbox;
  - phrases are counted from the playing track's own cycle 0, and 16 is added.
- Also found: the 023 scratch shift moves the audible track. The phrase origin is therefore `controller.origin + scratch shift`, read before `PatternOffset` drops it at switch time (tech §2.1 step 4).
- Spec, tech and tasks were written inline (as in 021 and 024). Workspace: own worktree `../strudel-client-tempo`, branch `feat/tempo-phrase-sync` from origin/main 13e31c5, because the shared checkout is used by other sessions. Spec number 027 was claimed with the 025/026 session.
- Next: implementation: one audio dispatch (Slices 1–2), then one web dispatch (Slice 3), which consumes the controller's `tempo` and `getTrackShift`.

## 2026-11-14 — implementation
- Two dispatches in parallel, with disjoint files and the API fixed by the tech spec:
  - **strudel-audio-engineer** (Slices 1–2): controller phrase origin, `getTrackShift`, 4 tempo modes, tempo hold; `scratchRuntime.mainShiftCycles()`; 38 controller tests and 2 scratch tests.
    - RED proofs: phrase origin `6 failed`→green; match glide `6 failed`→green; Stop ends hold `2 failed`; switch ends hold `3 failed`.
  - **strudel-web-engineer** (Slice 3): settings, the `migrateLegacyTempoGlide` load-time migration, the section UI, wiring, 9 locales and tests.
    - RED proofs: migration, section disabled state, wiring.
    - `pnpm build:cloudflare` OK (`_worker.js` dir 1.89 MB).
    - Browser check on a temporary harness page (port 4337): desktop en/he and 390 px; no overflow, targets 44/50 px, RTL mirrored.
- Main-session checks:
  - Re-read the hold code (one setCps wrapper at a time; keep ignores the same tempo).
  - Confirmed a same-track Update doesn't reset cps: the only resets are at Stop and in resetEditor.
  - Controller tests 107/107.
- Spec corrections:
  - AC 2.1 Cut example 5.5 → 4.5 (arithmetic; Change Log).
  - Tech §2.3 amended: the migration needs a load-time write.
  - Tech §2.1 step 5 amended: Dip timing under match/keep.
- Found a **pre-existing CI flake** on clean origin/main: Node 24.12 with 2 workers fails about 1 run in 3. An i18n language leak ('es') hits TransitionPicker, TransitionSettingsSection, ScratchFeel025, ScratchSnapPlatter023 and ScratchSection. A passive probe stopped it reproducing (timing). Handed to the test engineer: victim files set 'en' themselves, plus a time-boxed culprit hunt. The 025/026 session was told.
- Next: Feature Testing (strudel-test-engineer), then verify and review.

## 2026-11-14 — feature testing, verify, review
- **strudel-test-engineer** (Slice 4): new 027 block in `packages/mixer/test/transitionAcceptance.test.mjs` (real repl + Cyclist), plus website tests (migration, 390 px, picker unchanged).
  - AC coverage: every AC in §2.1–2.3 has a positive and a negative test (the table is in the agent report).
  - Not automatable: logged out, admin, embed (code path unchanged), and "no audible clicks" (cycle continuity and stepped tempo are tested).
  - RED proofs: R1–R12 (phrase origin, match glide, Stop, keep hot swap, switch during slide, steps < 16, migration, Snap 16, description).
- **i18n flake, root cause** (pre-existing on main):
  - In `settings.ts`, `syncLanguageFromI18n` runs once, 10 ms after the module loads, and copies i18next's cached language into `settingsMap`. When that lands during ScratchFeelLanguages025's 'es' case, the store keeps 'es'. Any later `settingsMap.setKey` then calls the un-awaited `i18n.changeLanguage('es')`.
  - Test fix: the culprit's afterEach resets the store; 6 victim files set i18n and the store to 'en' in beforeEach. The 025/026 session agreed to the edits in its test files.
  - Production fix (await the sync, no timer write): proposed as a follow-up.
- **Review** (strudel-reviewer, `review/027-tempo-phrase-sync.md`): 1 Major and 4 Minor. The owner chose fix 1–4 (5 = bookkeeping).
  - Fixes from the same agents, each with RED→GREEN.
  - Audio: (1) a failed switch keeps the tempo hold (`_resumeTempoHold`); (4) `getTrackShift` may return `{cycles, pending}`, and `_phraseStart` counts a pending shift only from its `atCycle` (wiring now `scratchRuntime.mainShift()`).
  - Web: (2) dimmed once under Off; (3) Glide during greyed out for Echo-out too.
  - Spec Change Log updated for 1 and 3.
- **Main-session RED spot-check:** the `_resumeTempoHold(prevHold)` call removed gives `Tests 3 failed` (`expected null to be 'keep'`, `'glide'`, `0.536… to be 0.583…`); restored, `cmp` identical, 10 passed.
- **Gates (worktree):**
  - Node 24.12 with `--maxWorkers=2`, 3 runs: 225/225 twice; one run had only the known `formatEngine.comments` 200k-space timeouts under load (pre-existing, also seen on clean main).
  - Earlier: 6 runs, 5 green, 1 with a rare EqualizerCompact render-null (not reproducible by the 026 owner, not touched by 027).
  - Shuffled seed 7 green; lint 0; format-check clean; `pnpm build:cloudflare` OK, `_worker.js` 2.7 MB.
- **Browser:** harness page (the real TransitionSettingsSection) at desktop en/he and 390 px; screenshots `docs/screenshots/027-{desktop-en,desktop-he,compact-390-en-he}.png` (untracked). The live tempo check (cps over time during a Match switch) is planned on prod after deploy, because /repl needs Google sign-in locally.
- Next: commit, then the push gate.

## 2026-11-14 — push, deploy, prod check
- Owner said yes at the push gate. `git push origin feat/tempo-phrase-sync:main`: 29b2bc6..c886f14 (96a419c spec, f598e3f feature, facfe5b i18n flake test fix, c886f14 docs). Push gate passed. Deploy run 43599455783 for c886f14: `success`.
- Prod check in the owner's signed-in Chrome (the Playwright profile was signed out):
  - **Migration on real data:** the stored `transitionGlide: "true"` had become `transitionTempo: "glide"` on first load.
  - **UI:** Settings → Transition shows 5 Snap choices (Off … Next 16 cycles), the description "Phrases are counted from where the playing track began.", and 4 Tempo choices with descriptions. Selecting Crossfade / 4 / Off / Match, then glide stored `transitionTempo: "match"`.
  - **Live tempo measurement not done.** The main repl's scheduler isn't reachable from the page: the `window.scheduler`/`repl` globals are module exports, and the fiber walk found only the non-started preview schedulers. The tab group then closed during the search. The Match/Keep tempo behaviour is covered by the acceptance tests through the real repl and Cyclist (`transitionAcceptance.test.mjs`), not by a prod measurement.
  - Two temporary tracks (`zz-027-a-120`, `zz-027-b-140`) were created for that check and deleted.
- **Owner's transition settings were changed for the check** (Filter sweep / 2 / Next cycle / Glide during → Crossfade / 4 / Off / Match, then glide) and not restored, because the tab closed. Flagged to the owner.
- Bookkeeping: feature-map transition row (Snap 16 and phrase origin, Tempo modes, `getTrackShift`, migration, wiring test), roadmap ticked, spec and tech Status Completed, task 5.1.
- Follow-ups:
  - the production fix for the language sync race (`settings.ts` timer plus un-awaited `changeLanguage`) was taken by the 028/029 session;
  - the rare EqualizerCompact render-null is unexplained.
