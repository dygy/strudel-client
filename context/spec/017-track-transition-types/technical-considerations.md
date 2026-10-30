# Technical Specification: Transition Types for Switching Tracks

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** In Review
- **Author(s):** Claude (for the owner, Dygy)

---

## 1. High-Level Technical Approach

Every type except **Off** becomes a **pattern-level transition** inside the one main scheduler. The old track is never stopped. On a switch, the new code is evaluated as usual. Just before the scheduler receives the new pattern, a hook replaces it with one combined pattern: the old pattern up to the end of the transition, and the new pattern shifted so that its cycle 0 lands on the transition start `T`. Both are shaped by per-event envelopes.

Because both tracks share one scheduler and one cycle grid, they are beat-aligned by construction. Snapping is just the choice of `T`. A track whose code fails never reaches the scheduler, so the old one keeps playing.

**Off** keeps today's instant path (stop, restart at cycle 0, evaluate) unchanged. **Dip** keeps its smooth master-gain ramps. Its evaluate, however, now happens *before* the fade, through the same hook, so a broken new track no longer leaves silence.

Hook: `repl()` already accepts `editPattern` (`packages/core/repl.mjs`, called on every `setPattern`). `StrudelMirror` passes it through `...replOptions` (`packages/codemirror/codemirror.mjs`). It is not used today.

Research facts this relies on, all verified in the code:
- Events carry `whole.begin` in cycles, so `filterHaps`, `late(T)`, `withHap` and `withContext` cover windowing, shifting and envelopes.
- superdough computes `gain *= velocity` (`superdough.mjs:505`). Scaling `velocity` therefore fades without overwriting the user's `gain` or `postgain`.
- `Cyclist.setCps` keeps cycle continuity, which makes tempo glides safe.
- Every `$:` layer is stacked in `repl.evaluate`. Its id lives only in query state, not on events, so layered intro needs the layers exposed (see 2.4).

---

## 2. Proposed Solution & Implementation Plan

### 2.1 Components

| Path | Area | Responsibility |
|---|---|---|
| `packages/mixer/transitions/buildTransition.mjs` (new) | audio | **Pure** function: `buildTransition({ oldPat, newPat, layers, T, length, type, glide }) → Pattern`. One envelope builder per type (crossfade, filterSweep, bassSwap, echoOut, layeredIntro, cut, dip-window). No Web Audio, so it is fully testable with `queryArc`. |
| `packages/mixer/transitions/envelopes.mjs` (new) | audio | Envelope shapes over `[T, T+L]`: equal-power gain, exponential cutoff sweep, midpoint step. Clamping and combining with user values. |
| `packages/mixer/TrackTransitionController.mjs` (new) | audio | Stateful orchestration on the main repl. It owns the pending switch, the `editPattern` hook, the track origin offset, the tempo plan, the queue, the end-of-transition cleanup, Dip's master-gain ramps, Echo-out's bus and loudness trim. It emits `track-transition-{start,waiting,end,error}` window events. **Replaces `SmoothTransitionManager`** (see 2.6). |
| `packages/mixer/transitions/loudness.mjs` (new) | audio | AnalyserNode tap that measures RMS over a window and computes the trim. |
| `packages/core/repl.mjs` | engine | **Additive:** expose the per-layer patterns of the last evaluate as `state.layers = [{ id, pattern }]`, set before `setPattern`. No behaviour change. |
| `website/src/settings.ts` | web | New persisted keys: `transitionType` (`off\|dip\|cut\|crossfade\|filterSweep\|bassSwap\|echoOut\|layeredIntro`), `transitionLength` (`1\|2\|4\|8\|16`, default `4`), `transitionSnap` (`0\|1\|4\|8`), `transitionGlide`, `transitionMatchLoudness` (booleans). One-time migration from the old `strudel-smooth-transitions` key (2.5). |
| `website/src/repl/useReplContext.tsx` | web | Pass `editPattern: controller.editPattern` to `StrudelMirror`. Create the controller where `SmoothTransitionManager` is created now. `evaluateNewTrack` reads the settings **at the moment the switch begins**: Off goes to the existing instant path, everything else goes to `controller.switchTo(code, settingsSnapshot)`. Expose the controller state (waiting / transitioning) through the context. |
| `website/src/repl/trackSwitch.ts` | web | Unchanged decision logic. `switchesInFlight` now lasts until the controller resolves, which happens at the end of the transition (it already awaits `switchTrack`). |
| `website/src/repl/smoothTransitionNotifier.ts` | web | Listen to `track-transition-error`. The existing messages are reused, plus one new one for a broken new track ("the old track keeps playing"). |
| `website/src/repl/components/panel/MixerSettings.tsx` | web | Replace the toggle and seconds slider with a Transition radio group plus a description, a Length segmented control in cycles, and the three modifiers, with greyed-out states per the spec. **Note:** spec 016 is changing this file now. Implement only after 016 lands. |
| `website/src/repl/components/TransitionPicker.tsx` (new) + `Header.tsx` | web | Compact picker (type + length) next to Update, bound to the same settings. Shows the waiting state while a snapped switch waits. On compact screens it goes wherever 016 puts Update. |
| `website/src/i18n/locales/*/settings.json` (9) + `website/src/i18n/types.ts` | web | Labels and descriptions for 8 types, Length, 3 modifiers, the picker and the new error message. |

### 2.2 Switch algorithm (`TrackTransitionController.switchTo`)

1. **Snapshot** the settings, `oldPat = repl.state.pattern`, and `oldCps = scheduler.cps`.
2. **Capture tempo.** While the new code evaluates, wrap `scheduler.setCps` on the instance so that `setcps` and `setcpm` in the new code are *recorded, not applied*. Restore the wrapper in `finally`. `newCps = recorded ?? 0.5`. The `0.5` default matches today's restart, where `onToggle(false)` resets the tempo to 0.5.
3. **Arm** a pending switch and call `repl.evaluate(code)`. The existing `resetEditor` prepare step still runs before it.
4. **In `editPattern(newPat)`**, while armed:
   - `T` = the next boundary of `max(snap, typeMinSnap)` cycles strictly after `scheduler.now() + 0.25` cycles of safety margin (the scheduler queries about 0.1 s ahead). If snap is 0 and the type needs no boundary, `T = now + margin`. Cut and Echo-out have `typeMinSnap = 1`.
   - Return `buildTransition({ oldPat: stripLocations(oldPat), newPat, layers: repl.state.layers, T, length: L, type })`, with `newPat` shifted by `late(T)`.
   - Record `origin = T` and disarm.
5. **Not consumed.** If `evaluate` resolves and the hook was never called, the code failed (`repl.evaluate` swallows errors). Then: restore `oldCps`, emit `error { evaluateFailed: true }` and reject. The old track was never touched.
6. **Tempo plan.**
   - Glide off: `setCps(newCps)` at `T`.
   - Glide on (overlapping types only): a driver steps `setCps` linearly from `oldCps` to `newCps` across `[T, T+L]`, about 16 steps per cycle. It is triggered from a timer that reads `scheduler.now()`.
   - Dip: `oldCps` holds until the fade-down ends, and `newCps` is set at that silent moment.
7. **Waiting.** Emit `waiting` until `now ≥ T`, then `start`.
8. **End.** At `now ≥ T + L` (Dip: `T + 2L`), call `repl.setPattern(newPat)` so the old pattern is no longer queried, emit `end`, run draw cleanup for the old track, and process the queue. The queue keeps only the latest code; the restart flag is sticky, as in today's manager.

**Origin offset.** `editPattern` always returns `pattern.late(origin)` when no switch is armed, so a later hot-swap of the same track keeps its position. `origin` resets to 0 on stop (`onToggle(false)`) and on the Off path's restart. This is what lets "the new track starts from its own beginning" coexist with "never stop the scheduler".

### 2.3 Per-type envelopes (`buildTransition`)

Every envelope is sampled at the event's `whole.begin` (onset). Old-track events with an onset `≥ T + L` are dropped. Old events whose `whole.end > T + L` are **truncated** to end at `T + L`, with `clip` lowered so samples are cut too. Truncation only reaches notes queried **after** the switch is armed.

**Voice release.** Notes the scheduler handed to superdough before the switch keep their full length; a 16-cycle pad measured ~0.10 RMS after the end of a crossfade. So when the switch is armed (in the `editPattern` hook, before `T`), the controller snapshots the main engine's active superdough voices; all of them belong to the old track, because the new pattern isn't scheduled yet. Once the new tempo is known it releases them: a fade on each voice's output gain, then `stop`, so they are silent:
- overlapping types: from `T` to `T + L`, in AudioContext seconds at the faster of the two tempos, so a glide can't make it late;
- Dip: from `T` to the end of the master fade-down;
- Cut, Off, Echo-out: a 30 ms ramp at `T`. Echo-out releases only the sources; the echo bus tails ring on.

The fade never jumps: `cancelAndHoldAtTime(start)` plus a linear ramp to 0 where supported, otherwise `setTargetAtTime(0, start, …)` (Firefox), which decays from the value at `start`. Voices of the headphone preview share the AudioContext but play through another controller and are never released. A failed evaluate releases nothing.

| Type | Old track | New track |
|---|---|---|
| Cut | onsets `< T` only | `late(T)` unchanged |
| Dip | onsets `< T + L` (inaudible after the ramp) | `late(T + L)`. Master `destinationGain` ramps to 0 over `[T, T+L]` and back to 1 over `[T+L, T+2L]`, with seconds converted per side's cps |
| Crossfade | `velocity *= cos(π/2·p)` | `velocity *= sin(π/2·p)`, where `p = (onset−T)/L` (equal power) |
| Filter sweep | crossfade gain + `hcutoff = max(user, 20·100^p)` Hz | crossfade gain + `cutoff = min(user, 300·(20000/300)^p)` Hz |
| Bass swap | `p < ½`: full; `p ≥ ½`: `hcutoff = max(user, 250)` and gain `cos` over the second half | `p < ½`: `hcutoff = max(user, 250)`; `p ≥ ½`: user value |
| Echo-out | onsets in `[switch press, T)` get `orbit = ECHO_ORBIT`, `delay = 0.7`, `delayfeedback` chosen so the tail decays about 60 dB over L cycles (capped at 0.85); onsets `≥ T` dropped | `late(T)` at full level |
| Layered intro | crossfade-out gain | layer `k` of `n` (in `$:` order) muted (dropped) until `T + L·k/n`; if `n ≤ 1` or `all()`/`each()` transforms are present → crossfade |

Controls use the canonical names superdough reads (`cutoff`, `hcutoff`, `velocity`, `orbit`, `delay`, `delayfeedback`). Aliases such as `lpf` and `hpf` resolve to them when the controls are registered; the tests assert this.

### 2.4 Engine change (upstream impact)

The one-line additive change in `packages/core/repl.mjs` makes `evaluate` call `updateState({ layers })` before `setPattern`, where `layers` is the `$:` list it already builds. That is a new optional state field. No public function or behaviour changes, and upstream stays mergeable. The flow log records the divergence. `superdough` gains three additive fork exports for the voice release (2.3, 2.8). No other `@strudel/*` behaviour changes. `@strudel/mixer` is fork-only.

### 2.5 Data

- **No Supabase change.** Nothing is stored server-side. Settings are per-browser `settingsMap` keys.
- **Migration** runs once, client-side. If `localStorage['strudel-smooth-transitions']` exists and the new keys are unset: `enabled: true` → `transitionType = 'dip'`, otherwise `'off'`; `duration` in seconds → the nearest of 1/2/4/8/16 at 2 s per cycle (ties round down, so 4 s becomes 2 cycles). The old key is removed afterwards.

### 2.6 Replacing `SmoothTransitionManager`

Its behaviours move to the controller, with equivalent tests:
- the queue keeps the latest code;
- the restart flag is sticky;
- a failure restores the gain with an 80 ms ramp;
- `AudioContext` is resumed;
- error events are emitted.

The class and its test file are deleted in the same change (it is only instantiated in `useReplContext`). The dead `AudioMixer`, `TransitionMixer` and `MixerControls` are **not** touched here; that is a separate cleanup.

### 2.7 Runtime

Everything runs in the browser. No Worker, SSR, API, env var or secret changes. There are no new pages, so the 3 MiB Worker budget is unaffected; only the client bundle grows by a few KB.

### 2.8 Audio graph

| Node | Created | Disconnected | Ramps |
|---|---|---|---|
| `destinationGain` (existing) | — | — | Dip: `linearRampToValueAtTime` 1→0→1. A failure restores with an 80 ms ramp. Never `setValueAtTime` jumps except to anchor the current value. |
| Loudness `AnalyserNode` | lazily, once, tapped from `destinationGain` (a read-only fan-out) | on controller `destroy` | none |
| Echo orbit bus | by superdough's own orbit cache on the first echo send | superdough's lifecycle (as with any orbit) | the delay tail decays by feedback |
| Loudness trim | **no node**: the trim is a `velocity` multiplier on the new track, applied through the origin wrapper and stepped per cycle | — | stepped over 1 cycle in 4 steps, clamped to −24 dB … +9 dB (asymmetric: a louder new track is turned down fully, a quieter one is boosted by at most 9 dB because more would clip), reset on the next switch |
| Old-track voices (superdough sources) | by superdough | superdough's own `onended`; the release `stop`s them | released when the switch arms: `cancelAndHoldAtTime` + linear ramp to 0 (fallback `setTargetAtTime`), silent by `T+L` (Dip: end of fade-down; Cut/Off/Echo-out: 30 ms at `T`) |

**Loudness algorithm:** RMS of the master output over the last 2 s before `T`, then RMS over 1 cycle after the transition ends (only the new track is playing). The trim is `oldRMS/newRMS` clamped to [−24 dB, +9 dB] and fades in over the next cycle. *Assumption:* the trim therefore settles about 2 cycles **after** the transition ends, not "once it ends" as the spec's criterion says. The criterion will be amended to "within 2 cycles after the transition ends". Measuring the new track while it overlaps the old one is not separable.

**superdough divergence (fork addition, upstream stays mergeable):** `packages/superdough/superdough.mjs` gets three additive exports, each commented as a fork addition for spec 017:
- `getActiveSoundIds(owner = main controller)` lists the ids of `activeSoundSources` whose voice plays through that controller. A `WeakMap` records the owner beside the existing `activeSoundSources.set`.
- `releaseSounds(ids, endTime, startTime)` releases the ids still present and skips ended ones.
- `releaseSoundHandle(handle, start, end)` does the per-voice ramp and stop, and never throws.

No existing code path changes: the voice-stealing loop is untouched.

**Preview engine:** it has its own `AudioContext` and repl, and is never given `editPattern` or the controller. Preview → Update goes through `runUpdate` as today, so it is a transition only when it is a real switch.

---

## 3. Impact and Risk Analysis

- **System dependencies:** the main repl/scheduler, superdough controls, `trackSwitch` bookkeeping, the draw/highlight pipeline and the settings store. Spec 016 owns `MixerSettings.tsx` and `Header.tsx` right now, so this work is sequenced after 016 lands.

| Risk | Mitigation |
|---|---|
| Samples ignore event duration, so truncation won't end a long sample and the old track rings past `T+L`. | Set `clip` on truncated old events (tests assert it), and release the voices that were already sounding when the switch armed (2.3, voice release). Measure in the browser with an analyser after `T+L` (Verify step). |
| The new code's `setcps` leaks to the old track during async `samples()` loading. | The instance-level `setCps` wrapper is active for the whole evaluate (2.2 step 2). |
| `resetDefaults` / `resetGlobalEffects` before evaluate change the *old* track's sound during an overlap. | Accepted known limit: it is only audible for tracks that set global defaults or effects. It is listed in the spec's known limits after verify. |
| The cost of querying two patterns, with layered intro and filter math. | Limited to `L ≤ 16` cycles. The old pattern is dropped at the end via `setPattern(newPat)`. |
| Old events highlight the wrong code. | `stripLocations` (`withContext`) on `oldPat`. |
| Visuals: `pianoroll` and other painters of the old track keep drawing during the overlap. | Accepted for the overlap. Draw cleanup runs at the end (spec 2.6: "disappear by the end"). |
| Echo orbit collides with a user orbit. | `ECHO_ORBIT = 15`, a high, documented constant. |
| MIDI/OSC outputs receive the scaled `velocity` too. | Intended (the fade reaches MIDI as well). Documented. |
| `NeoCyclist` (sync mode) `setCps` semantics differ. | The controller uses only `scheduler.now()` and `setCps`, which both cyclists implement. Covered by a test with each. |
| `editPattern` runs on every `setPattern`, so a bug breaks all playback. | The hook is a pure pass-through when not armed and `origin = 0`. A unit test asserts it returns the identical pattern object. |
| The upstream `repl.mjs` change. | Additive state field only. Noted as a divergence in the flow log and the commit message. |

---

## 4. Testing Strategy

- **Unit (vitest, `packages/mixer/test/`):**
  - `buildTransition.test.mjs`: for each type, query `[T−1, T+L+1]` and assert onsets, `velocity`, `cutoff`/`hcutoff`, `orbit`/`delay`, truncation and `clip`, layer entry times, and the `n ≤ 1` fallback. Each is a positive + negative pair; for example, crossfade old events have `velocity < 1` inside the window and none after it.
  - `TrackTransitionController.test.mjs` with a fake scheduler/repl, extending `webAudioMock.mjs`:
    - `T` for each snap value;
    - captured `setcps` is not applied during evaluate;
    - glide steps and Dip's tempo held at silence;
    - a failed evaluate leaves `oldPat`, `oldCps` and the gain untouched;
    - the queue keeps the latest code;
    - the end calls `setPattern(newPat)`;
    - the origin wrapper is preserved across hot-swaps;
    - the pass-through identity when idle;
    - Dip ramps never jump.
  - `loudness.test.mjs`: trim math and clamping.
- **Engine:** `packages/core/test/repl.test.mjs`: `state.layers` matches the `$:` ids, and is empty without `$:`.
- **Web (`website/src/repl/__tests__/`):**
  - settings migration (enabled/duration → type/length, ties);
  - `MixerSettings` radio group and greyed-out states;
  - picker ↔ settings sync;
  - Off still takes the instant path;
  - i18n keys present in all 9 locales (the pattern of the existing locale-key test).
- **Browser (Verify, Playwright on `pnpm dev`, measured not listened):**
  - per type, sample an `AnalyserNode` RMS every 50 ms across the transition: no zero-RMS gap in overlapping types, nothing old after `T+L`;
  - `destinationGain.gain.value` over time for Dip;
  - `scheduler.cps` over time for glide;
  - node counts before and after 10 switches;
  - console clean;
  - RTL locale screenshot of the settings and the picker.
