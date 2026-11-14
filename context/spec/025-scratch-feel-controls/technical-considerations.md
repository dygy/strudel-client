# Technical Considerations — 025 scratch feel controls

## 1. Where the numbers live today (verified 2026-11-14)

- `packages/mixer/scratch/scratchPhysics.mjs` defines these constants:
  - `SCRATCH_BRAKE_SECONDS` 0.1
  - `SCRATCH_SPINUP_SECONDS` 0.4, with MIN 0.2 and MAX 0.8
  - `SCRATCH_SNAP_BEAT_CYCLES` 0.25
- `scratchBrakeRate` and `scratchSpinUpRate` already take a `seconds` parameter. The release planner (around line 98–105) reads `SCRATCH_SPINUP_SECONDS` directly. `scratchBeatSeconds(cps)` returns the step.
- `scratchDsp.mjs:99` computes `brakeLen` from the constant. The release message is `{type:'release', id, beatSeconds}` (`scratchProcessor.mjs:13`, with `beatSeconds` 0 meaning off).
- `ScratchDeck.mjs:69` stores `this.snap = true`, and `:314` decides `beatSeconds` at release.
- `website/src/repl/scratch/scratchRuntime.ts` has the `snap: boolean` store field and `setSnap`. `SCRATCH_SNAP_STORAGE_KEY = 'strudel-scratch-snap'`, which holds `'true'`/`'false'`.
- `website/src/repl/components/scratch/ScratchSection.tsx:251` is the checkbox. The platter animation reads the release plan (`selectedSpin`).

## 2. Design

### 2.1 Physics (pure, `scratchPhysics.mjs`)

- Add `SCRATCH_SNAP_GRID = { off: 0, half: 0.125, beat: 0.25, bar: 1 }`, giving the step in cycles. Add `scratchSnapSeconds(grid, cps)`. Keep `scratchBeatSeconds` as the `beat` case, for compatibility.
- Add `SCRATCH_FEEL_DEFAULTS = { brakeSeconds: 0.1, spinUpSeconds: 0.4 }` and the ranges: brake 0.02–1.0, spin-up 0.1–2.0. Add `sanitizeScratchFeel(x)`, which falls back to the default per field when a value is missing, out of range or NaN.
- The release planner takes an optional `spinUpSeconds` (default 0.4). Its stretch bounds become `[0.5×, 2×]` of it, so the 023 values 0.2 and 0.8 are reproduced exactly at 0.4. The nominal-lag formula uses the chosen spin-up.
- Keep the existing exported constants as the defaults. No 023 test changes, except where a test asserts that a constant is used.

### 2.2 DSP and messages

- The `scratchDsp` grab path reads the brake length from a per-deck `brakeSeconds`, set by a new `{type:'feel', brakeSeconds, spinUpSeconds}` message. A brake that is running keeps the length it started with.
- `release` gains `spinUpSeconds`, so the main thread and the worklet plan with the same number. A plan already running keeps its own.
- `ScratchDeck` gets `setFeel({brakeSeconds, spinUpSeconds})`, which posts the `feel` message and is kept for the next release. `snap` becomes `snapGrid` (`'off'|'half'|'beat'|'bar'`). The boolean `snap` setter is kept as a deprecated alias that maps `true` to `'beat'`, so external callers keep working.

### 2.3 Runtime, UI and persistence

- Store: `snapGrid` replaces `snap`, plus `feel: {brakeSeconds, spinUpSeconds}`.
- `strudel-scratch-snap` now holds `'off'|'half'|'beat'|'bar'`. The reader maps legacy `'false'` to `'off'`, `'true'` or missing to `'beat'`, and anything unknown to `'beat'`.
- New key `strudel-scratch-feel`, holding JSON `{brakeSeconds, spinUpSeconds}` and read through `sanitizeScratchFeel`.
- Every attached deck (main, and preview when it is created lazily) gets the current feel and grid on attach and on change.
- The platter's spin-up animation uses the plan's `spinUpSeconds`, so the picture follows. The brake animation uses `brakeSeconds`.
- `ScratchSection`:
  - a Snap `<select>` with 4 options, keeping 023's hint text adapted;
  - two `<input type=range>` sliders, each with a value readout in seconds (one decimal; the brake shows two decimals under 0.1);
  - a Reset button;
  - compact layout (spec 016) works.
- i18n keys in all 9 locales: `scratchSnap` (reused label), `scratchSnapOff`, `scratchSnapHalf`, `scratchSnapBeat`, `scratchSnapBar`, `scratchBrake`, `scratchSpinUp`, `scratchFeelReset` and `scratchFeelHint`.

## 3. Audio graph

There are no new nodes. The change is the parameters of existing worklet curves only. Brake and spin-up stay raised-cosine and click-free at every length in range. Very short brakes (0.02 s) are still continuous, because the curve has zero slope at both ends.

## 4. Tests

- **Physics:** the grid steps, `sanitizeScratchFeel`, and the planner with spin-up 1.5 (bounds 0.75–3), using the spec examples (Bar at 3.4 and 1.6 beats, ½ beat at 1.3).
- **DSP:** brake length follows `feel`, and a brake already running keeps its length.
- **Runtime:** migration of the stored values, persistence of feel, propagation to both decks.
- **UI:** the select, sliders and Reset; i18n completeness.

## 5. Upstream impact

None. `@strudel/mixer` is a package that exists only in this fork.
