# Technical Specification: Vinyl Scratch Control

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Approved
- **Author(s):** Claude (for the owner, Dygy)

---

## 1. High-Level Technical Approach

Each deck (main speakers, headphone preview) gets one `AudioWorkletNode`, the **scratch node**. It sits between the deck's `channelMerger` and `destinationGain`, through a new pre-gain insert slot on `SuperdoughOutput`.

The node does three things:
- While no one holds the platter, it passes the live signal through unchanged and continuously writes it into an 8-second ring buffer.
- On **grab**, it freezes the ring buffer at that moment and crossfades from live to the buffer over 10 ms. It then reads the buffer at a **target position** that the main thread moves, so rate and direction come from how fast the position moves, including backwards and standstill.
- On **release**, it crossfades back to the live input over 10 ms and resumes writing.

The scheduler is never touched, so the pattern keeps running and the return is always on the beat.

All inputs feed one `ScratchController` API: platter pointer, wheel, keyboard and MIDI jog. The API is `grab / moveBy(seconds) / setMotor(rate) / release`, aimed at the selected deck.

Areas:
- **audio:** the superdough slot, `packages/mixer/scratch/*` (DSP, worklet, deck, controller), and the MIDI jog adapter.
- **web:** the platter UI in settings, header and compact bar, the shortcut, the stop/update hooks, settings and i18n.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Audio graph

Main deck, after both this spec and the spec 008 EQ fix:
```
orbits → channelMerger → [pre-gain insert: scratch node] → destinationGain → [post-gain insert: EQ, spec 008] → destination
                                                                  ├→ recorders (spec 013/014 tap)
                                                                  └→ LoudnessMeter / Dip ramps (spec 017)
```
- The preview deck works the same way inside its own `SuperdoughAudioController` output: `channelMerger → scratch → destGain → equalizer → MediaStreamDest`. Both decks share one `AudioContext`. **Flow defect:** CLAUDE.md says each engine has its own context, but `PreviewEngine` receives the main one. The two scratch nodes are fully independent.
- **New slot in `packages/superdough/superdoughoutput.mjs`:** `SuperdoughOutput.setPreGainInsert(node | null)`, with a pass-through on `SuperdoughAudioController`.
  - It works in the same style as the spec 008 post-gain slot (`setOutputInsert`; check the exact name in that commit).
  - It stores the node and rewires `channelMerger → node → destinationGain`. `null` restores `channelMerger → destinationGain`.
  - `initializeAudio()`, called from `reset()` after `resetGlobalEffects`, rewires the stored node to the new merger and gain.
  - `disconnect()` disconnects only the edges it made into and out of the insert node, never the node's other connections.
  - This is an additive fork divergence (see §3).
- The node is created with `channelCount = destination.channelCount`, `channelCountMode: 'explicit'`, `channelInterpretation: 'discrete'` and `outputChannelCount: [channelCount]`. It buffers every channel. That is 8 s × sampleRate × 4 B per channel, about 1.5 MB per channel at 48 kHz, so about 3 MB per deck for stereo.
- **Idle cost:** the node copies samples in and out and writes the ring. No allocation in `process()`.
- **Teardown:** `ScratchDeck.destroy()` clears the slot (`setPreGainInsert(null)`), disconnects the node, and closes its port. `PreviewEngine.destroy()` calls it.

### 2.2 DSP: `packages/mixer/scratch/scratchDsp.mjs` (pure, unit-tested)

This is a plain class used by the worklet processor and directly by tests:
- **Ring:** `Float32Array` per channel, with a write index. `freeze()` records `grabIndex` and stops writing. `unfreeze()` resumes.
- **Read position:** `pos` in samples relative to `grabIndex`. It is clamped to `[-8 s, 0]`; past either edge the output is silent, which is the edge of the record.
- **Position smoothing:** `pos` follows `targetPos` with a one-pole smoother (time constant about 8 ms), so message jitter turns into a smooth rate. Motor mode adds `motorRate` samples per sample to `targetPos` (keyboard).
- **Read:** linear interpolation, or 4-point Hermite if it stays cheap, at fractional `pos`.
- **Standstill:** the stylus-velocity gain is `g = clamp(|Δpos per sample| / 0.05, 0, 1)` with its own 5 ms smoothing. It is applied to the scratch signal so a held platter is silent rather than a DC hold. A one-pole DC blocker (about 10 Hz) runs on the scratch path.
- **Mix:** `mix` ramps linearly 0↔1 over 10 ms (≥ 480 samples at 48 kHz). `out = live·(1−mix) + scratch·mix`. On release, writing resumes immediately, so live audio fills the ring while `mix` ramps down. Live input is never interrupted; it is only attenuated.
- **Bad input:** `NaN` or `Infinity` in `moveBy` and `setMotor` is ignored. A rate magnitude above 8× is clamped.

### 2.3 Worklet: `packages/mixer/scratch/scratchProcessor.mjs`

- It registers `scratch-processor` and wraps `scratchDsp`.
- **Port messages:** `{type:'grab'}`, `{type:'move', delta}` (delta in seconds), `{type:'motor', rate}`, `{type:'release'}`.
- `process()` returns `true`.
- **Loading:** the processor source is bundled as a string and passed to `audioContext.audioWorklet.addModule` through a Blob URL, the same pattern as `superdough/dspworklet.mjs`. It loads once per context; the promise is cached in a `WeakMap<AudioContext, Promise>`.
- It loads lazily on first `ScratchDeck.attach()`, after the context is running, so there is no cost before the user plays audio.

### 2.4 Main-thread API: `packages/mixer/scratch/{ScratchDeck,ScratchController}.mjs`

- **`ScratchDeck(audioContext, controller)`:**
  - `attach()` creates the node and inserts it via `controller.setPreGainInsert`.
  - Methods: `grab()`, `moveBy(seconds)`, `setMotor(rate)`, `release()`, `isGrabbed`, `destroy()`.
  - `release()` is idempotent and safe before `attach()` resolves.
- **`ScratchController`:**
  - It holds the decks `{ main, preview }` and the `selected` deck.
  - `releaseAll()` lets go of every deck.
  - `autoRelease(ms)` arms an idle timer that releases after the given time without movement. Wheel and MIDI use 250 ms.
  - It emits `change` events (grabbed or not, selected deck, deck available) for the UI.
  - It is a module singleton created in the website (see §2.6), not in the package.
- **Mapping:** one platter turn is 1.8 s of audio (33⅓ rpm). Pointer angle deltas become `moveBy(Δθ/2π · 1.8)`.
  - Wheel: one `deltaY` notch (normalised to 100 px) is `moveBy(∓0.06)`.
  - Keyboard: `setMotor(±1)` while held.
- Exported from `packages/mixer/index.mjs` with JSDoc.

### 2.5 MIDI jog: `packages/mixer/scratch/midiJog.mjs`

- **Pure decoder:** `decodeRelativeCC(value)` handles both common encodings. Two's complement (1..63 is +, 65..127 is −) is the default. "Binary offset" (64 is zero) is detected during Learn from the first values seen. Each tick is `moveBy(±1.8/128)` s, about 128 ticks per turn.
- **Adapter:**
  - Uses `enableWebMidi()` and `WebMidi.inputs` from `@strudel/midi`.
  - Listens to `controlchange` on every input.
  - **Learn:** the first CC message whose controller then sends ≥3 messages in 300 ms is assigned. Learn gives up after 10 s and keeps the old mapping.
  - The mapping `{ inputName, channel, controller, encoding }` is stored in `localStorage` key `strudel:scratch:midi`, inside try/catch.
  - Any jog message grabs the deck and moves it, then arms `autoRelease(250)`.
- **No MIDI support or access denied:** the adapter reports `unavailable` and a reason. The UI disables Learn and shows the note.
- **Dependency:** `@strudel/mixer` gets `@strudel/midi` as a dependency (workspace). The adapter is imported lazily, so the WebMidi bundle loads only when Learn is used or a mapping exists.

### 2.6 Website

- **`website/src/repl/scratch/scratchRuntime.ts`:**
  - Creates the `ScratchController` singleton.
  - Attaches the main deck when the main superdough controller exists. Hook it next to the PreviewEngine init in `useReplContext.tsx`, after `initAudio`.
  - Attaches the preview deck in the PreviewEngine init, and detaches it in its destroy.
  - Exposes a small nanostore (`$scratch`: `grabbed`, `selected`, `previewAvailable`, `playing`, `midi` state).
- **`useReplContext.tsx`:**
  - Call `releaseAll()` before stop, before `handleEvaluate`'s evaluate, and in `onToggle(false)`.
  - **Shortcut:** in the existing keydown listener add Alt+Shift+ArrowLeft/ArrowRight → `grab(); setMotor(∓1)`, ignoring `event.repeat`. A new `keyup` listener (for the arrow key, Alt or Shift) releases the deck.
  - When focus is inside the code editor (CodeMirror `.cm-editor` contains `document.activeElement`) or any input or textarea, the shortcut is **not** handled, so macOS word selection (Alt+Shift+←/→) keeps working there. Everywhere else it is handled with `preventDefault` (owner decision at the tech gate, 2026-11-12).
  - `blur` (window) releases the deck, so a key released outside the window can't stick.
- **Components (`website/src/repl/components/scratch/`):**
  - `Platter.tsx`:
    - An SVG record. It rotates by CSS transform while the deck plays (driven by requestAnimationFrame, nominal 33⅓ rpm). While grabbed, it follows the pointer angle.
    - Pointer events use `setPointerCapture`, `touch-action: none`, and a `wheel` listener registered with `{passive:false}` plus `preventDefault`, so the page doesn't scroll.
    - `size` prop: compact gives about 220 px for a finger, settings about 160 px.
    - Dimmed and inert when the selected deck isn't playing.
  - `ScratchSection.tsx` (Mixer settings): the platter, the deck switch (Speakers / Headphones, the latter disabled without preview), MIDI Learn / Forget with status, and a hint with the shortcut. It is mounted in `panel/MixerSettings.tsx` both with and without the preview mixer. Without a mixer only Speakers is offered.
  - `ScratchButton.tsx`: the header and `compact/CompactControlBar.tsx` button. It opens a floating popover with `Platter`, closed by an outside click or Escape. It follows the `TransitionPicker` pattern (same placement logic, `touch` prop).
- **Settings:** the selected deck is `scratchDeck: 'main' | 'preview'` in `website/src/settings.ts` (browser-stored like the transition settings). Remember that `settingsMap.get()` values come back as strings after a reload.
- **Shortcuts tab:** add the row in `panel/ShortcutsTab.tsx` and `i18n/locales/*/shortcuts.json`.
- **i18n:** new keys in `settings.json` (section title, deck labels, Learn/Forget, MIDI status and errors, hint) and `shortcuts.json`, for all 9 locales: ar, en, es, fr, he, ko, ru, sr, zh. Add a keys test like `i18n/__tests__/compactLayoutKeys`.

### 2.7 Data

None. There are no Supabase tables, migration or schema changes. The only state is browser-local: the setting `scratchDeck` and the MIDI mapping in `localStorage`. Saved-track shape is unchanged.

### 2.8 Runtime

All the new code runs in the browser. There is no Worker, SSR or API code, and no new env vars or secrets. The worklet source is a string inside the client bundle, so the Worker script size is unaffected. Pages stay prerendered.

---

## 3. Impact and Risk Analysis

- **Upstream impact:**
  - `@strudel/superdough` gains `setPreGainInsert`. It is additive: with no insert, the graph is identical to today. Its JSDoc must say "fork addition".
  - `@strudel/mixer` is fork-only.
  - No `@strudel/core` change, and the scheduler is untouched.
- **Dependency on spec 008 EQ fix:** both edit `superdoughoutput.mjs`. This spec lands **after** that commit and is rebased onto it, using the same slot style. Until it lands, the superdough slot task is blocked. The pure DSP, worklet, MIDI and UI tasks are not.
- **Spec 017 transitions:** Dip ramps `destinationGain` downstream of the scratch, so a Dip during a scratch also dips the scratch. A track switch calls `releaseAll()` first, so a transition never starts from a held platter.
- **Recordings:** the recorders tap `destinationGain`, which is after the scratch, so the scratch is recorded (functional spec 2.6).
- **Audio continuity:**
  - Every mix change is a 10 ms sample-accurate ramp in the worklet.
  - The DC blocker and velocity gain prevent a thump at standstill.
  - Ring edges are silent, with the velocity gain to fade.
- **Risks:**
  - **Worklet latency and jitter:** port messages arrive per render quantum batch. The 8 ms position smoother absorbs it.
  - **Loading before a user gesture:** the worklet attaches lazily after `initAudio`.
  - **`reset()` rebuilding nodes:** slot persistence, test-covered.
  - **Memory:** 3 MB per deck, allocated in the worklet constructor.
  - **A stuck grab:** a key released outside the window or a lost pointer. Window `blur`, `pointercancel` and `lostpointercapture` all release the deck.
  - **macOS shortcut clash:** resolved: the shortcut is ignored while the editor has focus.
  - **Multichannel outputs (>2):** handled generically by channel count.

---

## 4. Testing Strategy

- **`packages/mixer/test/scratchDsp.test.mjs`:** feed a known signal into the DSP:
  - Pass-through is bit-exact when idle.
  - After grab, `mix` reaches 1 within 10 ms and never jumps more than one ramp step per sample.
  - `moveBy(-x)` reproduces the input reversed.
  - Standstill output RMS is ≈ 0.
  - Positions past −8 s and past 0 give silence.
  - Release ramps back, and live is continuous through the ramp.
  - NaN and huge deltas are ignored or clamped.
  - Negative pairs: no grab gives no change; release without grab is a no-op.
- **`packages/superdough/test/preGainInsert.test.mjs`:** with the Web Audio mock:
  - The slot wires `merger → node → gain`.
  - It survives `reset()`.
  - `null` restores the direct edge.
  - It coexists with the 008 post-gain insert.
- **`packages/mixer/test/ScratchDeck.test.mjs` / `ScratchController.test.mjs`:**
  - Messages are posted in order.
  - `releaseAll` releases both decks.
  - `autoRelease` fires after idle and not while moving (fake timers, advanced explicitly).
  - `destroy` disconnects and clears the slot.
- **`packages/mixer/test/midiJog.test.mjs`:** both relative encodings, Learn assignment and timeout, and the stored mapping round-trip.
- **Website tests:**
  - `components/scratch/__tests__/Platter.test.tsx`: pointer angle → `moveBy`, wheel → `moveBy` with `preventDefault`, release on pointerup and pointercancel.
  - Keyboard tests: Alt+Shift+← grabs and releases on keyup, `blur` releases, and the shortcut is ignored while the editor or an input has focus (negative pair).
  - `ScratchButton` opens and closes (Escape, outside click), including the compact variant.
  - An i18n keys test across the 9 locales.
- **Browser (Playwright, measured):**
  - Play a pattern and grab via the UI.
  - Read `AudioContext` state and the node count before and after 5 grab/release cycles and a `reset()`, and check that there is no growth.
  - Check, via a test hook, that the worklet's reported `mix` reaches 1 or 0 within 15 ms.
  - Check the console is clean, the compact layout at phone width, and one RTL locale (ar).
