# Tasks: Performance Mode (030)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

- [ ] **Slice 1: Level meter tap (audio)**
  - [ ] 1.1 `website/src/repl/performance/levelMeter.ts`: `openLevelMeter(audioContext, source)` with a splitter and 2 analysers, as a fan-out with no destination edge; `read()` (peak/rms dB per channel, `over` at ≥ −0.3 dBFS); idempotent `close()`; `resolveMeterSource()` (EQ output tap, else destinationGain, else null); re-point on `subscribeMainEqualizer` (tech §2.6). **[Agent: strudel-audio-engineer]**
  - [ ] 1.2 Pure `meterBallistics(prev, reading, dtMs)`: peak hold 1500 ms then −20 dB/s, clip latch 2000 ms, floor −60 dB (tech §2.6). **[Agent: strudel-audio-engineer]**
  - [ ] 1.3 Unit tests `website/src/repl/performance/__tests__/levelMeter.test.ts`: −6 dBFS sine → −6 ± 1; `over` at −0.3 and not at −1; latch and hold timing; `close()` disconnects all and is idempotent; nothing reaches `destination`; source fallback order. **[Agent: strudel-audio-engineer]**

- [ ] **Slice 2: State, key, fullscreen, clocks, guard (web)**
  - [ ] 2.1 `website/src/repl/performance/performanceStore.ts`: open atom, toggle/open/close, persisted font size with clamp 16–64 / step 4 / default 28 (tech §2.1). **[Agent: strudel-web-engineer]**
  - [ ] 2.2 `performanceFullscreen.ts`: request on open (rejection swallowed), exit on close only if we entered, `fullscreenchange` closes the view (tech §2.1). **[Agent: strudel-web-engineer]**
  - [ ] 2.3 `performanceShortcut.ts`: Alt+Shift+P by `code`, capture phase, stops the event, ignores repeat; installed once (tech §2.4). **[Agent: strudel-web-engineer]**
  - [ ] 2.4 `performanceClock.ts`: pure `clockTick`/`clockResetSet`/`formatClock` + `installPerformanceClock` 250 ms ticker and `clockStore`; confirm when `trackIds().playing` changes (tech §2.5). **[Agent: strudel-web-engineer]**
  - [ ] 2.5 `closeGuard.ts`: `beforeunload` cancelled only while the main scheduler is started; installed once from `ReplEditor` (tech §2.7). **[Agent: strudel-web-engineer]**

- [ ] **Slice 3: Layout and strip (web)**
  - [ ] 3.1 `ReplEditor.tsx`: `data-performance`, hide (never unmount) the header, conflict notice, sidebar/drawer, panels and compact bar; mount `PerformanceStrip`; install the key, the clock and the guard; font-size override (tech §2.2). **[Agent: strudel-web-engineer]**
  - [ ] 3.2 `components/performance/PerformanceStrip.tsx`, `PerformanceClocks.tsx`, `LevelMeter.tsx` (using slice 1's API): Play/Stop, Update, Now/Next + Cue/Go (shared with `SetBar`, no duplicated logic), clocks with Reset, meter with clip light, A−/A+, Exit; logical classes, wraps at 375 px (tech §2.3, §2.6). **[Agent: strudel-web-engineer]**
  - [ ] 3.3 Entry points: a Perform button in `Header.tsx` (desktop) and a Perform item in `compact/CompactMoreMenu.tsx` (tech §2.3). **[Agent: strudel-web-engineer]**
  - [ ] 3.4 i18n: the 10 keys of tech §2.8 in all 9 locales + `website/src/i18n/types.ts`. **[Agent: strudel-web-engineer]**
  - [ ] 3.5 Unit/component tests next to each module, for 2.1–3.3 (the store, the shortcut, fullscreen, clock rows, guard, hidden-but-mounted, same editor node, strip with/without a set, font bounds, entry points). **[Agent: strudel-web-engineer]**

- [ ] **Slice 4: Feature testing**
  - [ ] 4.1 Map every acceptance criterion in `functional-spec.md` to a test or a named browser check; fill the gaps with positive + negative pairs; RED-validate at least one guard per section (§2.1–2.5). **[Agent: strudel-test-engineer]**

- [ ] **Slice 5: Verify (main context)**
  - [ ] 5.1 Full suite on Node 24.12 `--maxWorkers=2`, lint, format-check, `pnpm run typecheck` = 0, `pnpm build:cloudflare` with the worker size.
  - [ ] 5.2 Browser: enter/leave ×10 while playing (scheduler started, node count), meter on a playing track vs preview only, beforeunload cancelled/not, 375 px and RTL screenshots in `docs/screenshots/030-*.png`.

- [ ] **Slice 6: Bookkeeping**
  - [ ] 6.1 `context/product/feature-map.md`: a Performance mode row (paths, spec 030, tests, owner web + audio).
  - [ ] 6.2 Roadmap tick and spec Status Completed after prod verification; memory note.
  - [ ] 6.3 No migration (no schema change); i18n covered by 3.4.
