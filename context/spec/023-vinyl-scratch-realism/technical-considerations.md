# Technical Specification: Vinyl Scratch That Behaves Like a Real Record

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Approved
- **Author(s):** Claude (for the owner)

## 1. High-Level Technical Approach

There are three changes to spec 019's scratch.

1. **The ring never freezes.** `ScratchDsp` keeps writing the live input while the record is held. The read head follows an absolute "record position" `r` in ring samples, instead of a position pinned to the grab moment. `pos = r − writeHead`, kept in `[−bufferSeconds, 0]`, where 0 is the newest sample. Holding the record still makes `pos` fall by 1 sample per sample, and a forward push can reach 0, the newest sound. This fixes "the first push is silent".
2. **Physics.** A motor rate on top of the hand's movement: on grab it brakes from the current rate to 0 over about 0.1 s; on release it spins up from 0 to 1 over about 0.4 s. Both use smooth (e.g. raised-cosine) curves. The platter picture follows the same rate.
3. **The track moves (persistent lag).** On release, the deck's **lag** is `L = writeHead − r`.
   - **Snap on:** the target lag is `D = round(L_end / beat) · beat`, with `beat = 0.25 cycle / cps` and `L_end` the predicted lag at the end of the spin-up. The motor curve is stretched or shortened, with its rate kept within about [0, 1.1], so that the lag lands on `D`.
   - **Snap off:** `D = L_end`.
   - **`D = 0`:** a short catch-up above rate 1 (≤ 1.5) closes the lag.
   - **Pattern shift:** once the motor reaches 1 with lag `D`, the main thread shifts that deck's pattern **late by `D·cps` cycles**, using the spec 017 origin mechanism (`late(origin)` in `editPattern`). Voices already handed to superdough for the old timeline are released, and the voices of that deck only (`getActiveSoundIds`/`releaseSounds` by controller).
   - **Hand-over:** when the shifted live audio arrives (scheduler lookahead plus latency), the DSP crossfades from the ring to live over about 20 ms. Patterns are deterministic in cycle time, so `ring[t − D]` and the shifted live input at `t` hold the same content, and the crossfade is coherent.

## 2. Proposed Solution & Implementation Plan

### 2.1 DSP (`packages/mixer/scratch/scratchDsp.mjs`, `scratchProcessor.mjs`)

- **State:** `writeHead` (absolute samples), `r` (absolute, fractional), `motorRate`, `motorTarget` and the ramp, `lag`, `phase` (`live` | `held` | `spinUp` | `handOver`).
- The ring is always written. The read uses Hermite interpolation at `r`, and `r` is clamped to `[writeHead − len + guard, writeHead]`; at either edge the output is silent, as before.
- Hand moves: `moveBy(seconds)` moves `r`. The existing τ 8 ms smoother and the velocity gain stay.
- New messages: `grab`, `release({ snapBeats, cps })`, and `handOverReady`. `handOverReady` is sent by the main thread once the pattern shift has been applied and its lookahead has elapsed. The worklet then crossfades to live.
- New events to the main thread: `lagSettled({ lagSeconds })`, and `idle` when the hand-over is done.
- Keep the 019 behaviours: pass-through is bit-exact while live, nothing is allocated in `process()`, and the DC blocker stays.

### 2.2 Deck and controller (`ScratchDeck.mjs`, `ScratchController.mjs`)

- The deck forwards the new messages and exposes `onLagSettled(cb)`. The controller keeps per-source holds (spec 019).
- **The shift:** a new small `PatternOffset` (in `packages/mixer`, or an extension of `TrackTransitionController`'s origin) owns a per-deck `originCycles`. The main deck's `editPattern` hook is shared with spec 017, so compose the two: total origin = transition origin + scratch offset. Both reset on stop. A same-track Update keeps the offset (memory `update-must-hot-swap`, `transition-types-017`).
- **Preview deck:** `PreviewEngine`'s repl gets the same offset hook. If it has no `editPattern`, pass one in its `repl({...})` options.
- **Snap setting:** `strudel-scratch-snap` in localStorage, default true, read at release.

### 2.3 UI (`website/src/repl/components/scratch/{Platter,ScratchSection}.tsx`, `website/src/repl/scratch/scratchRuntime.ts`)

- The platter's angle integrates the deck's actual rate, which is the motor plus the hand. Send rate updates from the worklet about every 30 ms, or simulate the same curves on the main thread from the same constants.
- A Snap to beat switch with a hint goes in ScratchSection. i18n: `scratchSnap` and `scratchSnapHint` in 9 locales.
- Wiring: on `lagSettled`, apply the offset to the right deck's repl, release the stale voices and signal `handOverReady` after the lookahead (`scheduler` latency plus one tick).

### 2.4 Engine (`packages/core`)

- No change is expected: the offset goes through the existing `editPattern` (spec 017).
- If a core change turns out to be needed, it is reported first and goes to the engine specialist.

## 3. Impact and Risk Analysis

- **Coherent hand-over depends on determinism.**
  - Patterns that use real-time inputs (mouse signals, MIDI in, `Math.random`) won't match. The 20 ms crossfade keeps that click-free, but it may be audibly different. This is documented as a known limit.
  - Samples are deterministic, and so is `rand`, which is seeded by cycle.
- **A lag smaller than the lookahead.** When `D` is smaller than the scheduler lookahead plus latency, `ring[t − D]` could fall in the region recorded after the shift (old voices released, new ones not yet arrived). With snap on, `D` is 0 or at least 1 beat. For `D = 0` there is no shift at all: the catch-up ends at lag 0 and the hand-over is immediate. With snap off and `0 < D < lookahead`, hold the ring playback until `t − D` is before the shift time, i.e. delay the hand-over.
- **Holding past 8 s:** the lag would exceed the ring. Keep silence at the edge (spec 019). On release, `D` is clamped to at most `8 s − spin-up`.
- **Composing with spec 017 transitions:** a scratch during a transition. The simplest safe rule is that grabbing during a running transition is ignored and the platter is dimmed, or the transition finishes first. Pick one, test it and record it.
- **Recordings:** the scratch is pre-destinationGain, so recordings include it (unchanged).
- **Upstream:** none beyond the existing fork additions. The core is untouched if possible.

## 4. Testing Strategy

**Unit (`scratchDsp.test.mjs`):**
- with the record held still, `pos` falls at rate 1;
- a forward push right after the grab is audible (energy > 0), and the old code would fail this;
- a reversal produces output in both directions;
- the brake curve takes about 0.1 s and the spin-up about 0.4 s, with no sample step;
- snap lands the lag on a beat multiple within 1 sample; snap off gives the raw lag;
- `D = 0` catches up;
- the hand-over crossfade is coherent: with a deterministic test signal, the output RMS step is under 0.5 dB at the switch;
- the edges are silent.

**Controller and wiring:**
- `lagSettled` leads to the deck's offset growing by `D·cps`;
- the stale voices of that deck are released and the other deck is untouched;
- Update keeps the offset and stop resets it;
- the preview deck has its own offset;
- the snap setting persists.

**UI:** the Snap toggle renders, persists and appears in 9 locales; the platter angle follows the brake and spin-up.

**Browser:** a real-module measurement on a page that plays a deterministic 4-beat click pattern, with AnalyserNode or `getDebugState` traces:
- a 2-beat hold leaves the click 2 beats later;
- snap on vs off;
- no step at grab, release or hand-over;
- a forward push straight after the grab is audible.
