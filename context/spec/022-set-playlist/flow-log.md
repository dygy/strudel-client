# Flow log — 022 set playlist

## 2026-11-13 — Specs and tasks
- Produced: `functional-spec.md`, `technical-considerations.md`, `tasks.md`.
- Decisions (owner): Supabase table `set_lists`; two-stage Cue → Go; per-item type + length only; hotkey Alt+Shift+N. Tech spec approved in one review.
- Found while exploring: same-id Go would hot-swap (→ `force`); Ctrl+Enter while cued hits speakers (→ redirect to preview while cued); step ids unreliable (→ id/name/index resolution); no per-switch override in the REPL (→ `transition` param); admin view renders the same Panel (→ hide tab).
- Note: spec index 021 was taken by an untracked dir from another session (`021-eq-genre-presets-transparency`), left untouched.
- Next: implementation, one `strudel-web-engineer` dispatch (slices 1–5), then `strudel-test-engineer` (slice 6).

## 2026-11-13: Implementation (slices 1–5)
- One `strudel-web-engineer` dispatch in an isolated worktree (`.claude/worktrees/agent-adbfc8a0b91c3cc86`), because another session (021/023) was editing the main checkout, including every locale's `settings.json`.
- The implementer reported 20 guards proven RED→GREEN. Orchestrator spot-check: removing the `force` guard in `trackSwitch.ts` made 3 tests fail, and restoring it brought all 21 back to green. The suite on Node 24.12 with `--maxWorkers=2` was 192 files and 3907 tests, all passing.
- Deviations to review:
  - the instant path now awaits `repl.evaluate`, and that affects every switch;
  - Go advances once the cued code plays;
  - `force` also applies when nothing plays.

## 2026-11-13: Feature testing (slice 6)
- One `strudel-test-engineer` dispatch added 3 files and 46 tests, mapping every acceptance criterion to a test or to a browser check. No production bugs found. Suite: 195 files, 3953 tests, all passing.

## 2026-11-13: Migration on prod (owner-approved)
- `set_lists` was applied to prod Supabase (`iarlunyimplczudavrcl`) through the MCP `apply_migration`. Checked after: RLS on, 4 policies, 1 trigger.
- Before applying, prod's `update_updated_at_column` was checked and found byte-identical to the one in the migration, so the `tracks` versioning is unchanged.

## 2026-11-13: Browser verification (`pnpm dev` on :4330, signed in as the owner)
- Create, add and transition:
  - the empty Set tab shows; "New set" creates Set 1 (row in the DB);
  - 3 tracks were added through Add track;
  - transitions Default, Crossfade·8 and Cut·1 were saved (checked in the DB).
- Playing the set:
  - Play set shows the bar "Now: — / Up next: lofi / Cue";
  - Alt+Shift+N Cued lofi: the URL changed, the editor holds lofi, the preview started, the button shows Go;
  - pressing it again Went: lofi on the speakers;
  - Ctrl+U while rave was cued acted as Go;
  - "End of set" shows, the button is disabled and the key does nothing.
- Audio, from an analyser on `destinationGain`, sampled every 20 ms:
  - during the Cue of phonky, the speakers' RMS was 0.041 against 0.042 before, with destination gain 1.0 throughout;
  - the Go with Crossfade·8 ramped RMS gradually over about 3–12 s (phonky is louder), with no step change.
- Reload: same Now and Up next, nothing plays.
- Console: 0 errors.
- **Bug:** in the compact layout at 390 px in Hebrew, the touch SetBar is 161 px wide and the control bar overflows (`scrollWidth` 413). English fits. Sent back to the implementer.
- Screenshots: `docs/screenshots/022-{set-tab-empty,set-playing-en,compact-he}.png`.

## 2026-11-13: Review (`strudel-reviewer`), report in `review/022-set-playlist.md` (git-ignored)
- Findings: 2 major and 2 minor, all accepted by the owner:
  1. Go to a broken track on the instant path (Off) silenced the speakers.
  2. A forced Go during a running transition was ignored for the same track id.
  3. A failed Cue gave no feedback.
  4. The unload flush was not synchronous (no keepalive).
- The 7 deviations were judged acceptable.
- Fixes, through the same implementer:
  - A set Go while playing with Off now runs as a Cut through the controller, so the old track keeps playing if the new code fails. Plain Off switches are unchanged (017).
  - The in-flight guard compares code.
  - Cue failures show toasts (4 new keys × 9 locales).
  - The unload flush is synchronous `keepalive`.
- The compact bar was reworked:
  - the touch SetBar is an icon plus a short caption (`setListCueShort`/`setListGoShort`);
  - there is no ⋯ menu in compact; End set moved to CompactMoreMenu;
  - TransitionPicker has a 44 px floor.
- Re-verified by the orchestrator:
  - suite on Node 24.12 with `--maxWorkers=2`: 196 files, 4000 tests, all passing; format and lint clean;
  - build: the worker is 2.70 MiB (implementer's report);
  - browser at 360 px in ru and he: `scrollWidth` 360, no overlap, picker 50/56 px;
  - delete with Cancel keeps the set; Delete removes only the set (0 sets left, tracks intact, no track writes during the session).
- Screenshots: `docs/screenshots/022-compact-{ru-360,he-360-final}.png`.

## Agents dispatched: 4 (Explore, strudel-web-engineer, strudel-test-engineer, strudel-reviewer)
- Next: commit, rebase on `origin/main` (021 was pushed by the other session), then the push gate.

## 2026-11-13: Push and prod
- The first push, 9f1c6a2 (rebased onto 024's 36b8c4b; one conflict in the `useReplContext` afterEval, both calls kept), went red in CI. `CompactLayout.test.tsx` mocked `@src/lib/slugUtils` bare, and under `isolate:false` the mock leaked into `setUi.test.tsx` in CI's file order (19 failed). The deploy was skipped, so prod was untouched.
- Fixed forward with bd99cdb, a test-only change: a partial mock via `importOriginal`. The leak reproduced locally with both files in one worker and was green after the fix. The full suite with shuffled files on 2 and 4 workers was green on all 6 runs.
- Deploy run 43464881675 passed: check and deploy both green.
- Prod verification at strudel.dygy.app, signed in as the owner:
  - `/api/sets/list` answers 401 without a session (it was 404 before the deploy);
  - the Set tab is present;
  - created a set of lofi and phonky: Cue gave Go; Go put lofi on the speakers; Cue and Go again put phonky on, and the bar shows "End of set";
  - console: 0 errors;
  - the test set was deleted. The first delete hit `ERR_CONNECTION_CLOSED` during the 023 deploy window; the UI kept the set and the retry worked. A failed delete shows no toast (console only), which is a known limit.
- Tracks written during verification: 0.
- Bookkeeping done: Phase 6 in the roadmap, a feature-map row, spec Status set to Completed, memory notes.
- Not done: architecture.md (`/awos:architecture` suggested).
- Flow defect: `/ship` Step 10 assumes a green run follows a green local suite. CI's file order differs, so run shuffled seeds before the push gate.
