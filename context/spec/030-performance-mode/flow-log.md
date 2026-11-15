# Flow log — 030 Performance mode

## 2026-11-15 — Step 1–3: gather, workspace
- No issue (roadmap Phase 6 item). Prior art: zen mode (`isZen`, unmounts panels), set bar (022), EQ output tap (026 `getMainEqualizerOutputTap`), `beforeunload` only for canvas cleanup / emergency save.
- Spec 030 claimed with session strudel-client-4a (it holds 028/029). Worktree `../strudel-client-perf`, branch `feat/performance-mode`, rebased on 28f74c6.
- Owner choices: button + Alt+Shift+P; code + Now/Next + timer + levels, code editable; close guard whenever music plays.

## 2026-11-15 — Step 4: spec, tech, tasks
- `functional-spec.md`, `technical-considerations.md`, `tasks.md`. Clip light at −0.3 dBFS (limiter ceiling) rather than 0 dBFS, since the EQ limiter keeps the output below full scale.
- Decision: hide with CSS, never unmount (zen mode's unmount would drop panel-owned audio state).
- Next: Step 5, audio + web specialists in parallel.

## 2026-11-15 — Step 5: implement (2 dispatches)
- Audio (strudel-audio-engineer): `website/src/repl/performance/levelMeter.ts` + 17 tests; follow-up fixed a Chrome crash found by the web engineer (ChannelSplitter.channelInterpretation is locked → upmix GainNode in front); `webAudioMock.mjs` splitter now throws like Chrome.
- Web (strudel-web-engineer): store, fullscreen, shortcut, clock, close guard, ReplEditor hide-not-unmount, PerformanceStrip/Clocks/LevelMeter, `useSetBarModel` shared with SetBar, Header Perform + exported PlayButton, CompactMoreMenu item, 10 keys × 9 locales.
- `trackIds().playing` flips at evaluate (before the snap wait); the clock holds the old id while `waiting` and resets on `track-transition-start`.
- Main-context check: suite 245/245 files, 5013 tests (Node 24.12, 2 workers); tsc 0; RED spot-check closeGuard (guard removed → 4 failed; restored → 7 passed).
- Flow defect: eslint ignores all `**/*.ts`/`**/*.tsx`, so `pnpm run lint` covers none of this code; only tsc + Prettier apply.
- Next: Feature Testing slice (strudel-test-engineer).

## 2026-11-15 — Step 4.1 feature testing, Step 6 verify (browser), Step 7 review
- strudel-test-engineer: AC→test table, +28 tests, RED→GREEN per §2.1–2.5. Suite 245 files / 5041 tests on Node 24.12 ×2.
- Unhandled `window is not defined` (nanostores persistent delayed unmount after jsdom teardown) from the new font-size store → `persistentAtom(..., { listen: false })`; perf-related files re-run clean.
- Browser (temp signed-out harness on dev :4337, deleted after; no .dev.vars in any checkout):
  - Alt+Shift+P (real key) from the editor: view opens, same #code node, text unchanged, font 28px; exit → 18px.
  - Meter in Chrome on a sawtooth: aria-valuenow −10.9…−15.8 dB.
  - 11 opens → 33 meter nodes (splitter + 2 analysers each), 33/33 disconnected; repl.evaluate calls 0; scheduler started throughout.
  - beforeunload: playing → defaultPrevented true (and Chrome showed the real dialog on navigation); stopped → false.
  - Headless Chrome refused fullscreen → view still covers the window (AC 2.1 refusal path).
  - 375px + he (RTL): mirrored, wraps, scrollWidth 375.
  - Screenshots: docs/screenshots/030-perf-open.png, 030-perf-375-rtl.png.
  - Not reached in browser: real fullscreen/Esc (headless), preview-only meter (harness has no preview engine; unit-tested via other-context skip), −6 dBFS exact (unit-tested).
- Review: review/030-performance-mode.md — 2 Major, 3 Minor. Owner accepted #1, #3, #4, #5 (#2 harness already deleted). Sent: #1 recorders + #4 → audio; #1 canvas + #3 + #5 → web.
- Flow defect: the Playwright MCP writes screenshots/logs into the main checkout (allowed roots), not the worktree; moved and cleaned by hand.

## 2026-11-15 — Review fixes, final gates
- Audio: #1 recorders → `recording/recordingUnload.ts` (beforeunload asks while recording; pagehide downloads `engine.snapshot()` as WebM, engine not stopped) + `recordingUnload030.test.tsx`; #4 meter re-resolves the followed source at ~4 Hz.
- Web: #1 canvas cleanup → `canvasUnloadCleanup.ts` on pagehide; #3 TrackConflictNotice visible in the view; #5 fullscreen exit chained after a pending request.
- Spec/tech change log updated (Stay changes nothing; recording asks on close; WebM emergency file).
- Main-context gates: Node 24.12 ×2 → 247 files / 5059 tests, exit 0; Node 26 default → 247 / 5059, exit 0, no unhandled errors; tsc 0; format clean; lint 0.
- `pnpm build:cloudflare` first FAILED in jsdoc-json: the new test helper `packages/codemirror/test/editorFixture.mjs` used a TS-style `@param` type (`doc?:`). CI's `pnpm run test` runs the same jsdoc step. Fixed to plain JSDoc; build OK, worker 2.7M.
- Flow defect: the specialists' runs never exercised jsdoc (they ran vitest directly), so the docs-build breakage only surfaced at build:cloudflare.
- Next: commit, push gate.
