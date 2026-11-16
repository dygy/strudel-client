# Technical Specification: Master FX

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Claude (for the owner)

---

## 1. High-Level Technical Approach

There are four parts:

1. **A new insert slot in superdough** (audio area, an additive fork change). `setMasterInsert(node)` puts a node between the scratch slot and `destinationGain`. The `.dough()` direct inputs are routed into it too.
   - The resulting graph is `channelMerger → [scratch preGainInsert] → [master insert] → destinationGain`, with `directInputs → [master insert]`.
   - The slot is kept across `reset()`, exactly as the 008/019 slots are.
   - Everything that taps `destinationGain` therefore hears the FX: recorders, transitions/Dip, the EQ output insert, the analyser and the meter.
2. **A `MasterFx` audio stage** (`packages/mixer/masterfx/`, audio area). It is one object with one input and one output:
   - `input → beat-repeat worklet → filter (dry/wet crossfade) → split`;
   - `split → dry → output`;
   - `split → delay send → delay loop → delay level → output`;
   - `split → reverb send → convolver → reverb level → output`.

   It contains no UI or app knowledge. The DSP decisions (filter curve, grid maths, the roll state machine) are pure functions, tested in Node.
3. **A brake source for the scratch runtime** (web area). `scratchRuntime.brake(down)` grabs and releases the **main** deck with a new source, `'brake'`. It uses the deck's existing `grab()`/`release()`, so the Brake and Spin-up feel (025), the Snap and the hand-over to live (023) all apply unchanged.
4. **App wiring and UI** (web area):
   - a `masterFxRuntime.ts`: install when audio is ready, settings persistence, a hold registry with auto-release, a Stop hook and the grid source;
   - the MIDI targets, including the engine's new `hold` kind (audio area, `midiMap.mjs`);
   - the Settings panel, the performance-view row, and i18n.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 superdough: the master insert slot (`packages/superdough/superdoughoutput.mjs`, fork addition)

- New fields: `masterInsert = null` (the input node) and `masterInsertOptions = null` (`{ output, onChannelCount }`).
- `connectPreGain(node)` and `disconnectPreGain(node)` currently wire `channelMerger → [scratch] → destinationGain`. Generalise the far end to **`this.preGainTarget()`**, which is `masterInsert ?? destinationGain`.
  - The merger edge, or the scratch insert's out edge, goes into the master insert when one is set.
  - `directInputs` connect to `preGainTarget()` too (in `initializeAudio` and in `connectDirectInput`).
- `setMasterInsert(node, { output = node, onChannelCount } = {})` (an input/output pair, because MasterFx is a sub-graph; see §2.5):
  - Wire the new path first, then drop the old one: the upstream edges into `node`, plus `output → destinationGain`. Only the slot's own edges are ever touched.
  - It is kept across `reset()`: `initializeAudio` re-wires it and calls `onChannelCount(destination.channelCount)`, as the 020 output insert does.
  - `null` restores the spec 019 graph exactly.
  - A swap while the context runs may click. The app installs the slot once, before the first note (§2.5), and only removes it on teardown, so no click-free swap is needed. Say so in the JSDoc.
- `getMasterInsert()`. JSDoc on both, with `@noAutocomplete`, like the siblings. Re-export through `getSuperdoughAudioController()`, as `setPreGainInsert` is.
- **Supradough across a reset.** A peer session raised a concern that after `resetGlobalEffects()`, supradough may keep playing into the old merger. A test must check that, after a reset with the master insert set, a supradough source reaches the new `destinationGain` through the insert. If the concern turns out to be real, fix it here, because this spec claims supradough is affected by the FX (functional §2.1).
- **Upstream impact:** additive. Without a master insert the graph and behaviour are identical to upstream plus the existing fork slots.

### 2.2 MasterFx stage (`packages/mixer/masterfx/`, new)

- **`MasterFx.mjs`**: `new MasterFx(audioContext, { channelCount, workletReady })`. It has `input`, `output`, `setFilter(pos)`, `setResonance(r01)`, `setDelay({ fraction, feedback, level })`, `setReverb({ decay, level })`, `setCps(cps)`, `throwDelay(on)`, `throwReverb(on)`, `roll({ startTime, length } | null)`, `stopTails()`, `setChannelCount(n)` and `destroy()`. It disconnects every node it creates.
- **Filter.** Two biquads in series, `lowpass` → `highpass`, on a wet path. Next to them runs a dry path. Two gains crossfade them over 10 ms.
  - Inside the dead zone (|pos| ≤ 3), dry = 1 and wet = 0. At rest the filter is therefore out of the signal (functional §2.1 "within float rounding").
  - Leaving the dead zone: first set both cutoffs to their "open" values (LP 20 kHz, HP 20 Hz), then crossfade to wet, then glide the cutoff.
  - Crossing from one side to the other stays wet: the side that was in use opens while the other one closes, with no jump.
  - Cutoff glides use `setTargetAtTime`, with τ ≈ 15 ms. Q = 0.707 + r01 × 7.3.
  - The pure mapping lives in `masterfx/filterCurve.mjs` as `filterParams(pos, r01) → { wet, lpHz, hpHz, q }`: exponential, LP 20 kHz → 150 Hz and HP 20 Hz → 6 kHz.
- **Delay.**
  - Graph: `send (0) → DelayNode (max 4 s) → feedback gain ↺`, then `→ level gain → output`.
  - `delayTime = fraction / cps`, clamped to ≤ 4 s and glided with `setTargetAtTime` (τ 50 ms) on a cps or fraction change.
  - The throw ramps `send.gain` to 1 or 0 with `linearRampToValueAtTime` over 10 ms.
- **Reverb.**
  - Graph: `send (0) → ConvolverNode → level → output`.
  - The impulse response is generated: stereo decorrelated noise × `exp(-6.9·t/decay)`, length = decay. `normalize = true`.
  - Changing the decay builds a second convolver and crossfades the two over 50 ms (setting `.buffer` on a running convolver clicks). Rebuilds are debounced to 150 ms.
- **`stopTails()`**: ramp both sends and both levels to 0 within 0.1 s, zero the delay feedback, then after 0.25 s restore the levels and the feedback, with the sends still closed. This meets functional §2.3's silence within 0.2 s.
- **Beat-repeat worklet** (`masterfx/beatRepeatWorklet.mjs` plus the pure `masterfx/beatRepeatCore.mjs`):
  - It is an AudioWorkletProcessor with an N-channel ring buffer of 8 s, where N = `channelCount`.
  - It keeps an absolute frame counter (`currentFrame`), so main-thread times convert to frames.
  - When idle, it copies input to output sample-exactly, with zero latency, always writing the ring.
  - `{ type: 'roll', startFrame, lengthFrames }`:
    - While `currentFrame < startFrame + lengthFrames`, the output stays live.
    - After that, the output plays `ring[startFrame + ((f − startFrame) mod lengthFrames)]`.
    - There is a 3 ms equal-power crossfade at each loop wrap, and at the start and end of the roll.
  - `{ type: 'length', lengthFrames }` applies at the next wrap.
  - `{ type: 'stop' }` crossfades back to live over 3 ms. The input is always written to the ring, which is the "slip": live resumes where the track is.
  - A `startFrame` older than the ring is clamped to the oldest frame. A `startFrame` in the future is treated as `currentFrame`.
  - The core state machine is pure (`createRollState`, `processBlock(state, inputs, outputs)`), so it can be tested in Node with Float32Arrays.
  - Load the module with `audioWorklet.addModule`, the way the scratch worklet is loaded (find and reuse that loader and its URL handling, so the Vite and Cloudflare builds both serve it).
  - **Channel count:** the processor's `outputChannelCount` is fixed when it is constructed, so `setChannelCount(n)` rebuilds the worklet node. This only happens on superdough's output reset, which is silent anyway.
  - Until the worklet module has loaded, MasterFx connects `input` straight to the filter stage, and roll is a no-op.

### 2.3 MIDI engine: the `hold` kind (`packages/mixer/midi/midiMap.mjs`, additive)

- `MIDI_MAP_TARGET_KINDS` gains `'hold'`. A target is `{ id, kind: 'hold', down(), up() }`.
- **Edges:** a note-on with velocity > 0 calls `down`, and a note-off (or note-on with velocity 0) calls `up`. A CC press (≥ 64 after < 64) calls `down`, and the release (< 64 after ≥ 64) calls `up`. Repeated presses while it is down are ignored.
- **Learn** binds on the first note-on or CC press, the same as for a `button`.
- **Auto-release:** a hold target that is down when its binding is cleared, replaced or imported over, when the map is disposed, or when its input disconnects, gets `up()`.
- **Persistence:** the binding is stored like a button's. Export and import carry it. An exported file from 031 (no hold rows) still imports.

### 2.4 Brake via the scratch runtime (`website/src/repl/scratch/scratchRuntime.ts`)

- Add a `ScratchSource` value, `'brake'`, and the action `brake(down: boolean)`:
  - `down` attaches the **main** deck if needed, then grabs it with source `'brake'`, whatever deck `selected` is. If the main deck is already held by another source, it returns false and does nothing.
  - On release it calls the main deck's release for `'brake'`, but only if the brake holds it. The usual release path then runs: spin-up, the lag hand-over and Snap.
- No new deck behaviour. The existing grab ramp is the 025 brake time, and the existing release ramp is the spin-up time.
- Check whether the platter UI shows a grab coming from `'brake'` as held. Showing it as held is fine; an inconsistent half-state is not.

### 2.5 App runtime (`website/src/repl/masterFx/`, new)

- **`masterFxRuntime.ts`**:
  - `installMasterFxWhenReady(audioReady)` creates the MasterFx on the main context and calls `controller.setMasterInsert(fx.input, { onChannelCount })`, then wires `fx.output → destinationGain`.
    - That last step needs care. `setMasterInsert` expects the node's output to reach `destinationGain`. Either the slot takes `{ input, output }`, or MasterFx exposes a single `node` whose output is the stage's output. **Choose the `(input, output)` pair form**: `setMasterInsert(inputNode, { output: outputNode, onChannelCount })`. Superdough then connects `output → destinationGain`, and re-connects it on reset.
  - The install is ref-counted like `mainEqualizer.ts`, because `useReplContext` mounts more than once. It is installed at mount, before the first evaluate.
  - **Settings store:** a nanostores `map`, persisted to localStorage `strudel-master-fx` with `{ resonance, delay: { fraction, feedback, level }, reverb: { decay, level }, repeatLength }`. Loading is sanitised: an out-of-range or garbage value falls back to the default. The filter position lives in a separate, non-persisted atom that starts at 0.
  - **Holds:** `hold(effect, holderId)` and `release(effect, holderId)`. An effect is on while any holder holds it. The holder ids are `pointer:<id>`, `key`, `midi:<targetId>` and `all-off`. A `held` store drives the lit buttons.
  - **Auto-release:** `window` `blur`, and `visibilitychange` to hidden, release every `pointer:*` and `key` holder. MIDI holds are released by the engine (§2.3). **All FX off** releases everything and centres the filter.
  - **Stop:** when the REPL goes from started to stopped (the same signal the header's Play/Stop uses), release all holds and call `fx.stopTails()`.
  - **cps:** follow the scheduler's cps (subscribe where 027/the transition controller reads it) and call `fx.setCps`.
  - **Roll grid:** `rollStart(lengthCycles)` returns `{ startTime }` (AudioContext seconds) of the last grid line of `lengthCycles`, counted from the playing track's start cycle, at the cycle that is **audible now**.
    - Use the same tempo and origin source the scratch deck's Snap uses (`ScratchDeck.setTempoSource` and its provider in `scratchRuntime.ts`, spec 023/027), so the two grids agree.
    - Correct for the scheduler's look-ahead/latency, so "audible now" is not "scheduled now".
    - Put the maths in a pure helper (`rollGrid.ts`) and test it.
  - **Brake:** `hold('brake')` calls `scratchRuntime.brake(true)`. If that returns false, the button is not lit.
- **Logged out and admin:** nothing in this path touches auth or saves.

### 2.6 MIDI targets (`website/src/repl/midi/midiTargetMeta.ts`, `midiTargets.ts`)

- A new group `masterFx` with these rows:
  - `masterFx.filter` (continuous). `read` maps pos to 0..1, and `write` maps v01 to pos, with CC 62–66 (v01 ∈ [62/127, 66/127]) going to 0.
  - `masterFx.delay`, `masterFx.reverb`, `masterFx.repeat` and `masterFx.brake` (hold), routed to `hold` and `release` with holder `midi:<id>`.
  - `masterFx.repeatLength` (button), stepping through the lengths.
- Soft takeover comes from the engine. On-screen knob changes reset pickup, the same way the 031 sliders do.

### 2.7 UI (`website/src/repl/components/masterfx/`, new)

- **`FilterKnob.tsx`**: an `<input type="range">` from −100 to 100, with `dir="ltr"` forced, so RTL does not flip LP/HP (as the 031 crossfader does).
  - It shows LP/HP labels and an "Off" state at the centre, and double-click resets it to centre.
  - Its `aria-valuetext` reads "Low-pass 40 %", "Off" or "High-pass 70 %".
- **`HoldButton.tsx`** uses `pointerdown` with `setPointerCapture`, and releases on `pointerup`, `pointercancel` and `lostpointercapture`.
  - Space or Enter keydown (not auto-repeat) holds, and keyup releases.
  - It sets `aria-pressed` while held, and is lit from the `held` store.
- **`MasterFxPanel.tsx`**: the Settings section, after `MixerSettings`, wired in `SettingsTab.tsx`.
- **`MasterFxRow.tsx`**: shown in `PerformanceStrip.tsx`. It wraps with flex-wrap, so there is no horizontal scroll at 375 px.
- Brake row note: the text from functional §2.5, with a link that scrolls to and focuses the scratch feel sliders.
- **i18n:** keys under `masterFx.*` in all 9 locales.

---

## 3. Impact and Risk Analysis

- **Data:** none. No Supabase table, migration or RLS change. localStorage keys: `strudel-master-fx` (new) and `strudel-midi-map` (new rows; the shape is unchanged).
- **Runtime:** browser only. No Worker, SSR or API code. One new worklet asset, so check it is emitted by `build:cloudflare`. The Worker script size is unaffected (client chunk only).
- **Audio graph:**
  - **Nodes created:**
    - the worklet;
    - the 2 biquads;
    - about 8 gains;
    - the delay;
    - 1–2 convolvers.
  - All are created once at install and disconnected on teardown. Convolver swaps disconnect the old convolver after its fade.
  - **Ramps:** 10 ms sends and filter crossfades, 3 ms worklet crossfades, τ 15 ms cutoff glides, τ 50 ms delay-time glides, and 50 ms convolver swaps.
  - **Preview engine:** untouched. The FX are only on the main context.
  - **CPU at rest:** the worklet copy plus the idle delay and convolver. The convolver's cost is the main one. If profiling shows it matters, disconnect the convolver while its send has been closed and its tail is under −90 dB. This optimisation is optional, and the browser check measures it.
- **Latency:** zero added (no look-ahead anywhere in the stage). The EQ's 6 ms still applies after it.
- **Interactions:**
  - Dip/transitions automate `destinationGain`, which is after the FX, so a throw tail is dipped along with the music. That is accepted.
  - A manual crossfader mix (031) passes through the FX like everything else.
  - The scratch deck runs before the FX, so a roll during a scratch repeats the scratched sound.
- **Risks:**
  1. The grid source being off by the scheduler latency makes rolls land late. Mitigation: a pure helper plus a browser measurement against a click track.
  2. Worklet asset paths in the Cloudflare build. Mitigation: reuse the scratch worklet loader.
  3. Wiring the master insert after `reset()`. Mitigation: a reset test, including supradough (§2.1).
  4. A stuck hold. Mitigation: the auto-release paths in §2.3 and §2.5, each tested.

---

## 4. Testing Strategy

- **Node (vitest):**
  - `filterCurve` endpoints and the dead zone;
  - beat-repeat core: idle copy exactness, first-pass live, wrap equality, slip-on-release, length change at the wrap, clamping;
  - `rollGrid` maths, including latency;
  - `midiMap` hold edges, learn and auto-release on clear, import and disconnect;
  - the superdough master-insert wiring, kept across `reset()`, including the direct inputs and the supradough source;
  - `masterFxRuntime` holds: multiple holders, blur/visibility release, All FX off, and the Stop hook calling `stopTails`;
  - sanitising the settings store;
  - `scratchRuntime.brake` acting on the main deck when preview is selected, and doing nothing while the platter holds it.
- **UI (vitest + RTL):**
  - the panel renders and persists;
  - the hold buttons' pointer, key and blur behaviour;
  - the filter knob's dblclick-to-centre and the RTL LP side;
  - the MIDI rows appear in the 031 panel;
  - the perf row renders in the strip.
- **Browser (Playwright, `pnpm dev`):** measure with an injected `AnalyserNode`/`AudioWorklet` probe on the main context:
  - rest equality;
  - filter attenuation on test tones;
  - delay echo spacing;
  - roll slice repetition;
  - brake to silence;
  - silence within 0.2 s after Stop;
  - MIDI hold through the WebMidi stub (memory: browser MIDI stub);
  - a screenshot of the panel (LTR and Hebrew) and of the perf row at 375 px.
