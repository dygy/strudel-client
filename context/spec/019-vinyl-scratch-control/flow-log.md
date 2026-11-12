# Flow log — 019 vinyl scratch control

## 2026-11-12 — Steps 1–4: gather, workspace, spec/tech/tasks

- **Source:** owner chat request (no issue). Option A chosen (audio-buffer scratch, not pattern jog).
- **Workspace:** git worktree `.claude/worktrees/019-scratch` (branch `worktree-019-scratch`), because a parallel session (`strudel-client-4a`) is running /fix on spec 008 EQ in the main checkout, and its untracked `context/spec/008-audio-equalizer/flow-log.md` is there.
- **Coordination with the 008 session:** it adds a post-gain insert (`setOutputInsert`, destinationGain→destination). This spec adds a sibling pre-gain slot `setPreGainInsert` (channelMerger→destinationGain). Two separate slots, agreed by both sides. Task 2.1 is blocked until the 008 commit lands; rebase onto it first.
- **Owner decisions:**
  - A header and compact-bar button plus the settings section.
  - Alt+Shift+←/→, not handled while the editor or an input has focus.
  - An 8 s reach.
  - Instant release on the beat.
- **Produced:** `functional-spec.md` (Approved), `technical-considerations.md` (Approved), `tasks.md`.
- **Flow defects found:**
  - CLAUDE.md says preview and main each have their own AudioContext. In fact PreviewEngine shares the main context (own controller and output only).
  - The arguments named `KeyboardShortcutManager` for the shortcut, but it is dead code (never instantiated). Shortcuts live in the `useReplContext.tsx` keydown handler.
  - `AudioMixer` is dead code too (per the 008 investigation).
- **Next:** Step 5. One strudel-audio-engineer dispatch (slices 1, 2 minus 2.1, 5.1) in parallel with one strudel-web-engineer dispatch (slices 3–4, 5.2) against the agreed API. 2.1 goes to the audio agent via SendMessage once 008 lands.

## 2026-11-12 — Step 5 (audio): strudel-audio-engineer report, spot-checked

- **Done:** 1.1–1.3, 2.2, 2.3 and 5.1. `packages/mixer/scratch/{scratchDsp,scratchProcessor,scratchWorklet,ScratchDeck,ScratchController,midiJog}.mjs`, 5 test files, PreviewEngine `scratchDeck`.
- **Re-run by orchestrator:** `vitest run packages/mixer` passes, 273/273.
- **Deviations accepted:**
  - The worklet is loaded through `vite-plugin-bundle-audioworklet` (a data URL, like superdough), not a Blob URL.
  - `getDebugState()` can resolve null.
  - `jog.reason` is a code (`unsupported`, `denied` or `failed`), which the UI translates.
  - `available` means attached.
- **Browser (realtime, stand-in controller):**
  - mix reaches 1 / 0 in 10.7 ms.
  - Standstill RMS is 0.
  - Reverse RMS is 0.35.
  - The max sample step through grab and release equals the sine's own step, so no click.
  - 6 nodes created and 6 disconnected.
- **2.1 request:** add `getPreGainInsert()` alongside `setPreGainInsert`.
- **Still blocked:** 2.1 (spec 008 not on origin/main yet).

## 2026-11-12 — Step 5 (web): strudel-web-engineer report, spot-checked

- **Done:** 3.1–3.4, 4.1, 4.2 and 5.2.
  - `website/src/repl/scratch/{scratchRuntime,scratchShortcut}.ts`
  - `components/scratch/{Platter,ScratchSection,ScratchButton}.tsx`
  - 9 locales × (settings + shortcuts)
  - Header and compact-bar mounts
  - 2 spec 016 compact tests updated to expect the new button
- **Deviation accepted:** the shortcut is its own once-installed listener (`scratchShortcut.ts`), not part of the re-registered keydown handler, so a held key isn't lost on re-render.
- **Re-run by orchestrator:** the whole suite is 163 files, 3394 tests, all passed.
- **RED spot-check by orchestrator:** with the `.cm-editor` guard removed, `scratchShortcut.test.ts` had 2 failures; restored, 10/10 pass.
- **Inline 6.1 part:** `website/src/i18n/__tests__/scratchKeys.test.ts` (35 tests). RED: removing `scratchMidiLearn` from ko fails 1; restored, all pass.
- **Build:** `pnpm build:cloudflare` OK, worker 2.7M.
- **Screenshots:** `docs/screenshots/019-{header-popover,settings-section,settings-section-ar,compact-popover-390}.png`.
- **Open follow-ups:**
  - RTL: the "Alt+Shift+←" hint text needs left-to-right isolation in ar and he.
  - Logged-in `/repl` needs `website/.env` (copied into the worktree, git-ignored). The `/embed` route works without login.
- **Still blocked:** 2.1 and the end-to-end audio check.

## 2026-11-12 — Step 7: review, fixes, rebase

- **Review:** `review/019-vinyl-scratch-control.md`. 0 Blocker, 0 Major, 7 Minor. The owner kept all 7 and chose to keep Alt+Shift, with a note for Windows.
- **Fixes:**
  - Audio (#1, #5): per-source holds and a lazily created preview deck (`ensureScratchDeck`). Mixer tests 287/287.
  - Web (#2, #3, #4, #6, #7, the Windows note, migration to the per-source API): the whole suite was 165 files, 3485 tests, all passed. Build OK, worker 2.7M.
- **Rebased onto `ada694c` (spec 008 EQ, local main, not pushed).** Three conflicts, all side-by-side imports or mock additions, resolved by keeping both sides.
- **Found by orchestrator:** the new `scratchReleaseWiring.test.tsx` (resetModules plus the real core and mixer) pushes the suite from 24 s to 77 s and causes `vitest-worker` fetch timeouts in other files. Without it, all 168 files pass in 23.9 s. Sent back to web for a rewrite.
- **2.1 unblocked** and sent to the audio engineer.
- **Worktree side effect:** the nested `.claude/worktrees/` dirtied the main checkout's tree and was picked up by root vitest, lint and format runs. Added to `.git/info/exclude` (local); config ignores offered to the 008 session.

## 2026-11-12 — Step 6: verify (orchestrator)

- **Suites, run by orchestrator** with Node 24.12.0 (as CI) and `--maxWorkers=2`:
  - vitest: 171 files and 3534 tests, all passed, in 25.66 s with no worker timeouts.
  - lint exit 0; format-check clean.
  - `pnpm build:cloudflare` OK; `_worker.js` is 2.7M.
- **2.1 done (audio):** `setPreGainInsert` / `getPreGainInsert` (fork addition) and the new tests `preGainInsert.test.mjs` and `scratchSuperdough.test.mjs`.
- **Realtime browser check** on the real superdough output (`/embed`, worktree dev :4399):
  - mix reaches 1 / 0 in 10.7 ms.
  - Standstill RMS is 0; reverse RMS 0.057; live RMS after release 0.056.
  - 5 grab/release cycles, then `resetGlobalEffects()`: the same node stays in the slot and no new nodes are created.
  - The console shows only unrelated errors (analytics 401, `ssrData` prop).
- **Audio agent's note that the MIDI jog loses its source:** checked and refuted. `scratchRuntime.grab/moveBy/release` forward the source (`scratchRuntime.ts:235-259`), and the runtime test covers `'midi'`.
- **Acceptance coverage (functional spec → evidence):**

  | Criterion | Evidence |
  |---|---|
  | 2.1 section and turning platter | ScratchSection.test; screenshot `019-settings-section.png` |
  | 2.1 dimmed when stopped | ScratchSection.test, Platter.test (inert negative) |
  | 2.1 Headphones disabled | ScratchSection.test |
  | 2.1 header popover (Escape / outside) | ScratchButton.test; `019-header-popover.png` |
  | 2.1 compact popover | ScratchButton.test (touch); `019-compact-popover-390.png` |
  | 2.2 hold still: silent, no click | scratchDsp.test (standstill RMS, ramp); browser RMS 0; max step = sine step |
  | 2.2 backwards | scratchDsp.test (reverse); browser reverse RMS |
  | 2.2 faster and higher | scratchDsp.test |
  | 2.2 8 s edge | scratchDsp.test |
  | 2.2 release on the beat, no click | scratchDsp.test (continuity); browser mix 0 in 10.7 ms. "On the beat" holds by construction: the scheduler is untouched and the live input is never paused |
  | 2.2 touch follows, no page scroll | Platter.test (pointer capture, touch-action). Not driven on a real phone |
  | 2.3 wheel nudge and auto-return; page doesn't scroll | Platter.test |
  | 2.4 keys pull and push, release | scratchShortcut.test |
  | 2.4 ignored in the editor (negative) | scratchShortcut.test, RED-proven by orchestrator |
  | 2.4 Shortcuts tab row | ScratchSection.test (Shortcuts tab) |
  | 2.5 Learn, assign, persist, Forget, timeout | midiJog.test |
  | 2.5 no MIDI or denied | ScratchSection.test, midiJog.test. Not exercised with real hardware (no controller available) |
  | 2.6 no unsaved changes | No save path touched (diff and reviewer); not separately tested |
  | 2.6 recording includes the scratch | By construction: recorders tap `destinationGain`, which is downstream of the slot (scratchSuperdough.test checks the order). No live recording made |
  | 2.6 Stop while held releases | scratchReplWiring.test, scratchRuntime.test |
  | 2.6 decks independent | scratchSuperdough.test (preview on its own controller) |
  | 2.7 9 locales | scratchKeys.test |

## 2026-11-12 — Steps 9–11: push gate, deploy, prod verified

- **Push gate:** the owner chose to push after the spec 008 EQ fix was out. ada694c was pushed by the 008 session; run 43316432975 passed.
- **Pushed:** `git push origin worktree-019-scratch:main`, ada694c..6718ab5 (2064968, 1163dac, 6718ab5).
- **Deploy run 43317158236** (headSha 6718ab5): Format, lint, test passed; Build and deploy to Cloudflare passed.
- **Prod verified** (strudel.dygy.app/embed, Playwright, real UI; worklet state read through an injected AudioWorkletNode wrapper plus the processor's `debug` message):
  - After Play, 1 scratch node; context `running`; live RMS 0.073.
  - Mouse grab, held still: mix 1, RMS 0.
  - Dragging 2.5 rad counter-clockwise moves the read head to −0.714 s (expected 0.716). Reverse RMS 0.073.
  - On release: mix 0, grabbed false, RMS 0.071.
  - Stop afterwards leaves it released. No new nodes. Console: 0 errors, 0 warnings.
- **Bookkeeping:** roadmap ticked (Phase 2), specs set to Completed, a feature-map row (already in 6718ab5), and memory notes.
- **Extra commit 8035f1e:** vitest, ESLint and Prettier ignore `.claude/` worktrees. The probe was red without it and green with it. It was requested by the 008 session, which had to use STRUDEL_SKIP_PUSH_GATE once because of this worktree.
- **Not verified on real hardware:** phone touch and a MIDI controller. A recording with a scratch hasn't been made either.
