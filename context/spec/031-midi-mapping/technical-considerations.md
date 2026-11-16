# Technical Specification: MIDI Mapping for Everything

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Claude (for the owner)

---

## 1. High-Level Technical Approach

The work splits into four parts:

1. **A generic MIDI map engine** (`packages/mixer/midi/`, audio area, pure plus a thin I/O layer). It holds bindings `{inputName, kind: 'cc'|'note', channel, number}` → target id. It parses CC and note messages and runs Learn with the 019/029 rules. It also does soft takeover and button edge detection, and stores to localStorage `strudel-midi-map`. It does not know what a target does: targets are registered by the app with `{ id, kind: 'continuous'|'button', read(): number /* 0..1 */, write(v01), press() }`.
2. **One Learn and one binding per control across the whole app.**
   - `scratch/midiLearnShared.mjs` already owns the one-Learn lock (`claimMidiLearn`). It gains a registry of *who holds which control*, so the jog, the feel knobs and the map engine all refuse each other's controls.
   - The jog and feel learns keep their behaviour (owner-verified on hardware). They only add a lookup into the shared registry.
3. **Two volume nodes and a manual mix mode** (audio area):
   - **Speakers volume** is a dedicated `GainNode` at the very end of the main output, after the EQ, before `destination`. It is independent of `destinationGain`, which the Dip automates, so a Dip never fights it and its restore lands on unity × volume naturally. Recordings and the spec 030 meter tap upstream of it, so they are unaffected by the room level.
   - **Headphones volume** is a `GainNode` at the end of the `PreviewEngine` output.
   - **Manual mix:** `TrackTransitionController` gains a mode where a transition's progress comes from a value the app sets (the fader) instead of the cycle clock. A fader end completes or abandons the transition.
4. **App wiring and UI** (web area):
   - a `midiTargets.ts` registry binding §2.1 targets to existing actions;
   - a `crossfader.ts` runtime that resolves "the next track" and drives the controller's manual mode;
   - the MIDI panel, volume and crossfader sliders, the performance strip slider, and i18n.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 MIDI input (audio): `packages/mixer/scratch/midiJog.mjs` (additive)

- `createMidiInputs({ loadMidi, onControlChange, onNote })`: also parse note-on / note-off (`0x90`/`0x80`, with note-on velocity 0 counted as note-off) and call `onNote(inputName, { channel, note, velocity, on })`. Existing callers pass no `onNote`, so nothing changes for them.
- Several consumers may need one input listener set. Add a small shared hub, `createSharedMidiInputs()`, ref-counted, so the jog, feel and map consumers don't each bind `midimessage` on every port. Moving the jog and feel onto the hub is optional; if it's done, their tests must stay green.

### 2.2 Shared control registry (audio): `packages/mixer/scratch/midiLearnShared.mjs`

- Generalise the control identity to `{ inputName, kind, channel, number }`. The existing CC mappings are `kind: 'cc'`, `number = controller`. `sameMidiControl` compares kind too, and a CC mapping without `kind` reads as `'cc'`, so stored 019/029 data still parses.
- `midiControlHolder(control, { storage }) → { owner: 'jog'|'feel:brake'|'feel:spinUp'|'map:<targetId>', label } | null`. It reads the jog key, the feel key and the map key from the same storage.
- `midiFeelConflict` and the jog's own conflict check also consult the map entries. A jog or feel learn refuses a control bound in the map, using the existing `scratchMidiLearnConflict` message with the holder's label.

### 2.3 Map engine (audio): `packages/mixer/midi/midiMap.mjs` (new) + `index.mjs` export

- **Storage:** `strudel-midi-map` = `{ version: 1, bindings: { [targetId]: control } }`.
  - A damaged entry is dropped and the rest are kept, as `readMidiFeelMappings` does.
  - Unknown target ids are kept (forward compatibility) but ignored.
- **API:**
  - `createMidiMap({ storage, loadMidi, targets, now })` returns:
    - `learn(targetId) → Promise<{ ok, control } | { ok: false, reason: 'timeout'|'cancelled'|'conflict'|'unsupported'|'denied', holder? }>`
    - `cancelLearn()`, `clear(targetId)`, `clearAll()`, `bindings()`
    - `exportJson()`, `importJson(text) → { ok, error? }`
    - `status()` (`'unsupported'|'idle'|'denied'|'ready'` + input names)
    - `subscribe(fn)`, `destroy()`
  - MIDI access is requested lazily, only on `learn()` or when bindings exist at create time.
- **Learn:**
  - It takes `claimMidiLearn`.
  - A continuous target needs 3 messages from one CC within 300 ms. A button target binds on the first note-on, or on a CC rising edge from < 64 to ≥ 64.
  - Timeout is 10 s. `cancelLearn` is wired to Esc by the UI.
  - A conflict is checked through `midiControlHolder` before binding, and also against this map's own other targets.
- **Dispatch:**
  - A continuous target gets `v = value/127`. **Soft takeover:** a per-target `picked` flag. Until picked, compare with `target.read()`. It picks up once `v` crosses it, comparing the sign of `(v − cur)` with the previous message's, or once `|v − cur| ≤ 0.02`. When the app reports an on-screen change (`notifyExternalChange(targetId)`), `picked` resets.
  - Buttons fire `press()` on note-on with velocity > 0, or on a CC rising edge. They don't repeat while held.
  - Each picked continuous message calls `target.write(v)`.
- **Pure helpers, exported for tests:** `ccToUnit`, `pickup(state, v, cur)`, `buttonEdge(state, msg)`, `parseMidiMap(raw)`.

### 2.4 Volumes (audio)

- **Speakers:** a `GainNode` placed between the main EQ output and `audioContext.destination`.
  - Where the main EQ is the output insert (`website/src/repl/mainEqualizer.ts` / `OutputInsertHost`), the insert's final edge goes `eq.output → masterVolume → destination`.
  - Before the EQ is installed, if `destinationGain` connects to `destination` directly, the volume node must still be in that path. Route the insert host so the volume node is always the last node, and give it a getter `getSpeakersVolumeNode()`.
  - Find the cleanest place. The constraints:
    - it stays separate from `destinationGain`;
    - it survives superdough `reset()` and EQ re-creation;
    - recordings and the meter tap stay upstream of it.
- **Headphones:** a `GainNode` at the end of `PreviewEngine`'s output, before its destination or device sink, on the preview's own `AudioContext`.
- **API** (`packages/mixer/volume.mjs`, new):
  - `setVolume(param, v01, ctx)` ramps with `cancelScheduledValues(now)`, then `setValueAtTime(current, now)`, then `linearRampToValueAtTime(gainOf(v01), now + 0.02)`. A taper is used where `gainOf(1) = 1`, `gainOf(0) = 0`, about −6 dB at 0.7 (e.g. `v01 ** 2` or a dB curve; pick one and test it). The value is clamped. No ramp starts when the value is unchanged.
  - Persisted at `strudel-volume-speakers` and `strudel-volume-headphones` (strings, default `'1'`, junk reads as 1).
- **Unity guarantee:** at `v = 1` the node's gain is exactly 1.

### 2.5 Manual mix (audio): `packages/mixer/TrackTransitionController.mjs`, `transitions/buildTransition.mjs`

- **`buildTransition`** gains an optional `progressAt?: (t) => number`. When given, every envelope uses it instead of `progress(t, T, L)`. Overlap starts at `T` and has no end until the controller finishes it. The default path is unchanged.
- **Controller:**
  - `beginManual(code, settings, { prepare } = {})`:
    - It works like `switchTo` (the same queue and evaluate path, the same failure behaviour: the old track keeps playing), but the armed transition has `manual: true`.
    - `buildType` maps `off`/`cut`/`dip` → `crossfade`; echo-out stays echo-out.
    - `T` is the phrase start as today (Snap, phrase origin from 027). `L` is the selected length, used only if the mix is later handed to the timed path.
    - The progress `p` starts at 0. It resolves when the mix completes or is abandoned.
  - `setManualProgress(p)`: clamps `p` to [0, 1] and stores it. `progressAt` reads it, so the next query window hears it.
    - At p ≥ 0.98, `_finish(a)` runs the normal completion (old voices released, tempo per mode).
    - At p ≤ 0.02 after it has been above, the mix is **abandoned**: the controller drops `active`, returns `editPattern` output to the old pattern (with its origin and trim, as before arming), releases the new track's sounding voices (`releaseSounds` on the ids started since T), restores tempo, and resolves `{ abandoned: true }`.
      - The new code was already evaluated into the repl. Abandon therefore re-evaluates or re-installs the old pattern. Use the stored `oldPat`, not a re-evaluate, so nothing is heard twice.
  - `handManualToTimed()`: called on Go during a manual mix. It converts to a timed transition from the current `p`, with `T' = now − p·L`, so the envelope continues smoothly. It then proceeds as a normal transition.
  - Tempo per `tempo` mode:
    - **glide:** cps = `oldCps + p·(newCps − oldCps)` while manual.
    - **jump:** new cps at begin.
    - **match/keep:** hold old cps as today. Match then glides after completion.
  - `getState().manual = { p, side? }` while active, and `_emit('track-transition-manual', { p })`.
  - Snap waiting: until `T` is reached, the mix is "waiting", as a timed switch would be. `p` may move meanwhile, and that is fine: it is heard from `T`.
- Tests: `TrackTransitionController.test.mjs` / `buildTransition.test.mjs` must cover:
  - progress source;
  - complete;
  - abandon (the old pattern is restored, new voices released, cps restored);
  - hand-over continuity (envelope value equal before and after the hand-over at the same t);
  - type mapping;
  - a failed evaluate keeps the old track.

### 2.6 App wiring (web)

- **`website/src/repl/midi/midiTargets.ts`:** builds the §2.1 target list.
  - **EQ bands** go through the same state path the EQ panel slider uses, not `AudioEqualizer` directly, so the slider moves, the value persists, and "stored while off" holds. Find that path in `EqualizerUI.tsx` / its store. If it lives only in component state, lift a small store (`website/src/repl/equalizer/eqStore.ts` or similar) without changing the panel's behaviour. Gain range −24…+24 maps from `v01`.
  - **EQ on/off and A/B** use the same handlers as the panel's buttons.
  - **Volumes:**
    - speakers via `volume.mjs` on the speakers node;
    - headphones via the preview engine;
    - the UI sliders call the same setter plus `notifyExternalChange`.
  - **Crossfader:** `crossfader.ts` (below).
  - **Cue/Go:** the set player's `press()` (the same as `SetBar` / `useSetBarModel`).
  - **Play/Stop and Update:** `context.handleTogglePlay` / `context.handleEvaluate`.
  - **Next/Previous type:** steps `transitionType` in `settings.ts` through `TRANSITION_TYPES`, wrapping.
  - **Performance mode:** `togglePerformance()`.
- **`website/src/repl/midi/useMidiMap.tsx`:** creates the map once per REPL (in `ReplEditor` next to the set player), registers the targets with fresh closures via refs, and exposes the map to the panel through context.
- **`website/src/repl/midi/crossfader.ts`:**
  - State is `{ playingEnd: 'left'|'right', position: 0..1, mixing: boolean }`. The playing end is persisted for the session only, not across reloads; after a reload it resets to left.
  - `setPosition(x)`: `p = playingEnd === 'left' ? x : 1 − x`.
    - Not mixing and `p > 0.02`: resolve the next track.
      - A set cued item goes through the set player, as a "manual go": stop the preview the same way Go does, then `controller.beginManual(code, itemSettings)`.
      - Otherwise, if the editor track differs from the playing track, it goes through `trackSwitch` the same way Update would, but with `beginManual`.
      - No next track: nothing happens.
    - Mixing: `controller.setManualProgress(p)`.
    - On complete: flip `playingEnd`, and let the set advance (the set bar shows the new Now) the same way Go's completion does.
    - On abandon: the item stays cued, and the preview is not restarted (it had been stopped). The spec says the next track "stays cued", so restart the cue on the headphones, the same as a fresh Cue, and confirm this in the review.
  - Go/Cue-Go during mixing calls `handManualToTimed()`.
  - Tie into `setPlayerController` / `setBridge` with a new `manualGo` path. Reuse `go`'s preview stop and its forced switch semantics; don't duplicate them.
- **UI:**
  - `components/panel/MidiSettings.tsx` (new), placed after `MixerSettings` in the Settings tab. It has the status line, groups, rows (binding text, Learn/Clear, "Move to pick up", errors), Clear all with an inline confirm, and Export/Import (a file input; download via a Blob link).
  - `MixerSettings.tsx` gains the Speakers volume, Headphones volume (when preview is active) and Crossfader sliders.
  - `components/performance/PerformanceStrip.tsx` gains a compact crossfader.
  - Logical classes only.
- **i18n:** about 40 keys in all 9 locales plus `website/src/i18n/types.ts`, listed in tasks.

---

## 3. Impact and Risk Analysis

- **Data:** none. localStorage keys `strudel-midi-map`, `strudel-volume-speakers`, `strudel-volume-headphones`. No Supabase change, no migration.
- **Runtime:** browser only. No SSR or API change, no new env var. The Web MIDI bundle stays lazy (`@strudel/midi` dynamic import).
- **Audio graph:**
  - It adds 2 permanent `GainNode`s: speakers (main context) and headphones (preview context). They ramp over 20 ms and are never re-created per change.
  - The speakers node must survive superdough `reset()` and EQ insert swaps (spec 020's click-free swap must still be click-free).
  - The manual mix is pattern-level, like every transition (per-event envelopes, plus `releaseSounds` on abandon/complete). It adds no Web Audio nodes.
- **Upstream impact:** none. `packages/mixer` is the fork's own package. `superdough` is untouched, unless the volume node needs an `OutputInsertHost` hook; if so, it must be additive, flagged as a fork addition, and documented.
- **Risks:**
  - **Abandon correctness:** restoring the old pattern after the new code was evaluated. The tests must prove the old pattern, its origin and its cps come back and that no new-track voice lingers.
  - **EQ state path:** MIDI writes must go where the panel writes, or saves and A/B diverge.
  - **029 learn regressions:** generalising the registry must leave the feel/jog tests untouched and green.
  - **Note-on from controllers that send note-on with velocity 0 as note-off:** handled in parsing.
  - **Per-event envelopes:** a fader move is heard from the next queried event onward (≈ 100 ms scheduler lookahead). A long held note keeps its start level. This is the same as timed transitions; state it in the README.

---

## 4. Testing Strategy

- **Unit (audio):**
  - `midiMap` pure helpers: CC → unit, the pickup cases, button edges, parse/dropping damaged entries, export/import round-trip and errors.
  - Learn: the 3-in-300 ms rule, button learn, timeout, cancel, conflict against own targets, jog and feel.
  - The registry, both directions.
  - Note parsing in `createMidiInputs`.
  - `volume.mjs`: taper, ramp shape (no jump: the anchor at the current value), unity.
  - Controller manual mode, as in §2.5.
  - The existing 019/029 tests unchanged and green.
- **Unit/component (web):**
  - each target's write/press reaching the right action (mocks);
  - the EQ band write moves the panel slider and persists;
  - crossfader position → p mapping per side, begin/complete/abandon flows with the set (mocked controller), no-next-track inertness;
  - the MIDI panel rows, Learn states, Clear all confirm, Export/Import, unsupported/denied states;
  - the sliders call the setters and drop the pickup;
  - i18n keys.
- **Browser (verify):**
  - with a virtual MIDI input injected (stub `navigator.requestMIDIAccess` in Playwright), Learn a band and a pad, drive them, reload, and confirm they still work;
  - speakers volume ramp measured on the main context (no step);
  - a manual crossfade begin, then midpoint, then complete, and separately an abandon, with the scheduler's pattern and node counts read;
  - Dip with volume at 50 % returns to 50 %;
  - an RTL screenshot of the panel.
