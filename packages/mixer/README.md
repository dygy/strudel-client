# @strudel/mixer

Audio mixing for the strudel-client fork. The package exists only in this fork and is not published.

## What's in it

- **`PreviewEngine`** (spec 006): a second Strudel engine with its own `AudioContext`, for the headphone preview. It has its own output device and its own EQ instance, driven by the EQ panel.
- **`TrackTransitionController`** and **`buildTransition`** (spec 017): track switches made at the pattern level (cut, crossfade, filter sweep and the rest), with a tempo choice and loudness matching (`transitions/loudness.mjs`). See [Transition settings](#transition-settings).
- **Vinyl scratch** (specs 019, 023, 025) in `scratch/`:
  - `ScratchDeck`, which wraps the `scratch-processor` AudioWorklet;
  - `ScratchController`, the per-deck inputs;
  - `midiJog`, MIDI jog wheels;
  - `scratchPhysics`, the brake, motor and snap grid, shared by the worklet and the on-screen platter;
  - `ScratchShift`, the pattern offset and the hand-over after a release.

- **MIDI mapping** (spec 031) in `midi/midiMap.mjs`: `createMidiMap` binds any knob, fader or pad to an app target, with Learn, soft takeover and JSON export/import. `scratch/midiLearnShared.mjs` keeps one control from being bound twice across the jog, the feel knobs and the map. See [MIDI map](#midi-map).
- **Volume** (spec 031) in `volume.mjs`: the speakers and headphones volume nodes, their taper and their ramped setter. See [Volumes](#volumes).
- **Master FX** (spec 032) in `masterfx/`: `MasterFx`, the speakers' filter, delay and reverb throws and beat-repeat, for superdough's master insert slot. See [Master FX](#master-fx).

The speakers' EQ is not in this package. It is `@strudel/equalizer`, installed on superdough's output insert by `website/src/repl/mainEqualizer.ts`.

## Transition settings

`switchTo(code, settings)` and `getSettings()` take `{ type, length, snap, tempo, matchLoudness }`. `normalizeTransitionSettings` fills in defaults (`DEFAULT_TRANSITION_SETTINGS`) and drops anything out of range.

- **`length`**: one of `TRANSITION_LENGTHS` (1, 2, 4, 8, 16 cycles).
- **`snap`**: one of `TRANSITION_SNAPS` (0, 1, 4, 8, 16). The transition begins on the next boundary of that many cycles (spec 027).
  - Boundaries are counted from the **phrase origin**, which is the playing track's own cycle 0. That is `controller.origin` (where the last transition placed the track; 0 after Play) plus the speakers' scratch shift, read from the constructor option `getTrackShift` when the switch begins. It returns cycles, or `{ cycles, pending: { cycles, atCycle } | null }`: a pending part (an Update during a scratch spin-up) only counts for a start at or after `atCycle`.
  - Cut and Echo-out wait for at least the track's next cycle. With snap 0, the other types start on the next beat of the global beat grid.
  - `transitionStart(now, settings, origin = 0)` gives the start. With origin 0 it is spec 017's.
- **`tempo`**: one of `TRANSITION_TEMPOS` (spec 027). "Old" is the playing track's tempo when the switch begins; "new" is what the new code's `setcps`/`setcpm` sets, or 0.5.
  - `jump` (default): both tracks at the new tempo from the start of the transition.
  - `glide`: the tempo moves from old to new over the overlap. Dip and Cut have no overlap and play it as `jump`.
  - `match`: both tracks at the old tempo; once the old track is gone, the tempo moves to the new one over `length` cycles.
  - `keep`: both tracks at the old tempo, and the new track stays there.
  - A legacy `glide: true` (spec 017) without a valid `tempo` means `glide`. Off ignores the tempo choice.
- Every tempo slide is stepped `GLIDE_STEPS_PER_CYCLE` (16) times per cycle through the scheduler's `setCps`, which keeps cycle continuity.

### The tempo hold after a transition

After a `match` or `keep` transition the controller keeps a **tempo hold** (`getState().tempoHold` is `'glide'` or `'keep'`). While it lasts, `scheduler.setCps` is routed through the controller:

- A `setcps` from a hot swap of the playing track ends a `glide` hold and applies at once.
- Under `keep`, a `setcps` equal to the track's own tempo is ignored, because its code is unchanged. A different tempo ends the hold and applies at once. Code that sets no tempo leaves the hold alone.
- The next switch, `stopped()` and `destroy()` end the hold, and so does the end of the slide. The next switch starts from the tempo the hold reached.
- A switch whose code fails to evaluate puts the hold back: Keep holds the same tempo again, and a slide continues from the tempo it had reached over what remains of its length.

When the hold ends, the scheduler's own `setCps` is restored. At most one controller wrapper is installed on it at a time.

### Manual mix (spec 031)

`beginManual(code, settings)` starts a switch whose progress comes from the app (the crossfader) instead of the clock. `setManualProgress(p)` sets it (0..1, from the playing end), and `handManualToTimed()` (Go during the mix) hands it to the timed path.

- **Same evaluate path as `switchTo`.** A failed evaluate rejects with `evaluateFailed`, and the old track plays on untouched. A manual mix is never queued: while another switch is in flight, `beginManual` resolves `{ ignored: true, busy: true }`.
- **Start.** The new track starts at the phrase start T, exactly as a timed switch would (Snap, phrase origin). Before T, the progress may move, but nothing of the new track is heard.
- **Shape.** The selected type's envelopes read the progress instead of time (`buildTransition`'s `progressAt`). Off, Cut and Dip have no in-between, so they mix as Crossfade. Echo-out fades the old track with the progress and sends it to its echo, while the new track comes in as in a Crossfade. Layered intro brings layer k of n in once the progress reaches k/n. Both tracks overlap until the mix ends: there is no end on the clock.
- **Voice sides.** While a mix is progress-driven (manual, or handed over), every event carries `_mixSide: 'old'|'new'` (`MIX_SIDE_CONTROL`). superdough records it per voice (fork addition: `getActiveSoundIds(owner, side)`), so the controller releases exactly one track's voices. No sound reads the control. Note that an output that forwards every control (OSC) sends it along during a manual mix.
- **Complete.** At `p ≥ MANUAL_COMPLETE_AT` (0.98), once T is reached, the old pattern is dropped. Every main-engine voice that is not the new track's fades out over `MANUAL_RELEASE` (0.1 s). That covers old-stamped voices started during the mix and unstamped voices from before it. The promise resolves `{ type, T, end, manual: true }`.
- **Abandon.** At `p ≤ MANUAL_ABANDON_AT` (0.02), after having been above it, the mix is dropped:
  - The old pattern is put back as the very object that was playing, with its origin shift and trim. Nothing is re-evaluated, so nothing is heard twice.
  - Only the new track's voices (stamped `'new'`) fade out. The old track's voices, including those started during the mix and those already scheduled for the lookahead, play on.
  - The tempo and the old track's tempo hold come back.
  - The promise resolves `{ abandoned: true, type, T }`.
- **Hand-over.** The envelope window becomes [T', T' + L] with `T' = now − p·L`, so the level heard now is unchanged. The old track's events end at T' + L. Its voices already sounding (everything not stamped `'new'`) fade out by then too, with a fade that begins `HANDOVER_RELEASE_DELAY` (0.3 s, at most half the remaining time) after the hand-over, so the voices already scheduled for the lookahead have started. A Glide continues from the tempo it reached. The promise resolves when that timed transition ends.
- **Tempo.** `glide` follows the progress (cps = old + p·(new − old), in 1/64 steps). `jump` sets the new tempo at T. `match` and `keep` hold the old tempo through the mix, and Match then glides to the new tempo over `length` cycles after completion.
- **State and events.** `getState().manual` is `{ p, left }` while a manual mix is in flight. Each change fires `track-transition-manual { p }`. Its `start` event has `end: null`, and its `end` event has `manual: true` or `abandoned: true`.

**Event granularity.** Like every transition here, the manual mix shapes each event as it is queried, not the audio stream. A fader move is heard from the next queried event onward, which is about the scheduler's lookahead (≈ 0.1 s) later. A long note keeps the level it started at. A held voice is only cut by a complete, an abandon or a hand-over release, never by the fader alone.

## MIDI map

`createMidiMap({ targets, storage?, loadMidi?, now?, hub? })` returns a map that knows nothing about what a target does. The app registers targets as `{ id, kind: 'continuous'|'button', read(), write(v01), press(), label? }` and replaces them with `setTargets` when its closures change.

- **Bindings** are `{ [targetId]: { inputName, kind: 'cc'|'note', channel, number } }`, stored in localStorage `strudel-midi-map` as `{ version: 1, bindings }`. A damaged stored entry is dropped and the rest are kept. An unknown target id is kept but ignored.
- **MIDI access** is requested only by `learn()`, or at creation when bindings are stored. `status()` is one of:
  - `'unsupported'`: no Web MIDI, known synchronously;
  - `'idle'`;
  - `'denied'`;
  - `'failed'`;
  - `'ready'`, together with the input names.
- **Learn.**
  - A continuous target binds a CC that sends 3 messages within 300 ms. A button binds on the first note-on or CC press.
  - Learn times out after 10 s. `cancelLearn()` (Esc) also stops it, and so does pressing Learn on the same row again. In every case the previous binding stays.
  - A control another target, the jog or a feel knob holds is refused with `{ ok: false, reason: 'conflict', holder: { owner, label } }`.
  - One Learn runs at a time on the page, across the jog, the feel knobs and the map (`claimMidiLearn`).
- **Soft takeover.** A continuous control drives its target only after it crosses `read()` or comes within 2 % of it. `notifyExternalChange(id)` (an on-screen change) resets that. `getState().awaitingPickup` lists the targets still waiting ("Move to pick up").
- **Buttons** fire once per press: on a note-on with velocity > 0, or on a CC ≥ 64 that follows a value < 64 (or is the first value seen). They don't repeat while held.
- **Holds** (spec 032), `{ id, kind: 'hold', down(), up() }`, get `down()` on the same press and `up()` on the release (note-off, or a CC < 64 after ≥ 64). They are learned like buttons; the press that binds is not a `down()`. A hold that is down gets `up()` when its binding is cleared, replaced or imported over, when `setTargets` drops it, on `destroy()`, and when its input disconnects.
- **Export and import.** `exportJson()` writes the file. `importJson(text)` is strict: one bad entry rejects the whole file and nothing changes. It returns one of these error codes:
  - `'not-json'`;
  - `'not-a-map'`;
  - `'unsupported-version'`;
  - `'invalid-binding'`;
  - `'duplicate-control'`;
  - `'conflict'`.
- **Shared input listeners.** `createSharedMidiInputs({ loadMidi })` is a ref-counted hub, so several consumers share one set of input listeners. Pass it as `hub`.

## Volumes

`volume.mjs` has the volume helpers.

- `volumeGain(v)` is `v²`: exactly 1 at 1 (unity, today's level) and about −6 dB at 0.7.
- `setVolume(param, v, ctx)` cancels, anchors at the current gain and ramps linearly over `VOLUME_RAMP_SECONDS` (20 ms). It schedules nothing when the target is unchanged.
- `createVolumeNode(ctx, v)` makes the permanent node.
- `readVolume` and `writeVolume` handle the stored levels, `strudel-volume-speakers` and `strudel-volume-headphones`. Junk reads as 1.

Each output has one permanent volume node at its very end, separate from superdough's `destinationGain`. A Dip automates `destinationGain`, so it never fights the volume, and its restore lands on unity × volume. Recorders and the level meter tap upstream of it.

- **Headphones.** The node is in `PreviewEngine`: `setVolume(v)`, `getVolume()`, `getVolumeNode()`. The chain is EQ → volume → MediaStreamDestination.
- **Speakers.** The node is in the website, `website/src/repl/speakersVolume.ts`: `getSpeakersVolumeNode()`, `setSpeakersVolume(v)`, `getSpeakersVolume()`, `subscribeSpeakersVolume(fn)`.
  - `mainEqualizer.ts` connects the main EQ's output into it.
  - When the EQ goes away, it becomes superdough's output insert. It survives `reset()` and the EQ's click-free swap, and superdough is unchanged.

## Master FX

`masterfx/MasterFx.mjs` is one stage with an `input` and an `output`, built on the main (speakers) context and put into superdough's master insert slot, between the scratch node and `destinationGain`:

```js
const fx = new MasterFx(ctx, { channelCount: ctx.destination.channelCount });
controller.setMasterInsert(fx.input, { output: fx.output, onChannelCount: (n) => fx.setChannelCount(n) });
await fx.ready; // true once the beat-repeat worklet is in the path (rolls are refused before)
```

The graph is `input → beat-repeat worklet → filter (dry/wet) → split`, then `split → output` (the dry signal, never turned down), `split → delay send → delay ↺ feedback → level → output` and `split → reverb send → convolver → level → output`. At rest (filter in its ±3 dead zone, nothing thrown, no roll) the output equals the input: the idle worklet copies sample for sample and the wet and send gains are exactly 0.

- **Filter.** `setFilter(pos)` takes −100 … +100: left is a low-pass from 20 kHz down to 150 Hz, right a high-pass from 20 Hz up to 6 kHz, both exponential (`filterCurve.mjs`, `filterParams`). Leaving the dead zone opens both filters, crossfades dry → wet over 10 ms and glides the cutoff (τ 15 ms). Crossing the centre stays wet. `setResonance(r01)` sets Q = 0.707 + r × 7.3 on the side in use.
- **Throws.** `throwDelay(on)` and `throwReverb(on)` ramp the send over 10 ms; tails ring out. The delay time is `fraction / cps`, at most 4 s, glided (τ 50 ms) by `setCps(cps)` and `setDelay({ fraction, feedback, level })`. `setReverb({ decay, level })` rebuilds the generated impulse response after 150 ms of rest and crossfades the convolvers over 50 ms.
- **Stop.** `stopTails()` closes both sends and fades the levels to 0 within 0.1 s. After 0.25 s it swaps in an empty delay line and convolver and restores the levels, with the sends still closed.
- **Beat-repeat.** `roll({ startTime, length })` (AudioContext seconds) repeats that slice once the track has played it, phase-locked to `startTime`; `roll(null)` goes back to live where the track is now; `setRollLength(seconds)` applies at the next repeat. The `beat-repeat-processor` worklet (`beatRepeatWorklet.mjs`, loaded by `beatRepeatLoader.mjs` like the scratch worklet) keeps an 8 s ring and uses 3 ms equal-power crossfades. Its DSP is the pure `beatRepeatCore.mjs`. A different channel count rebuilds the worklet node.
- **Settings.** `masterFxSettings.mjs` has the choices, ranges and defaults (`MASTER_FX_DELAY_FRACTIONS`, `MASTER_FX_REPEAT_LENGTHS`, `MASTER_FX_RANGES`, `MASTER_FX_DEFAULTS`), `sanitizeMasterFxSettings` and `nextRepeatLength`.
- `destroy()` disconnects every node the stage made and cancels its timers.

## History

Spec 006 first built a dual-stream `AudioMixer` (`AudioStream`, `TransitionMixer`, `ErrorNotifier`, `KeyboardShortcutManager`). The app never constructed it, because `PreviewEngine` took its place, so it was removed with its unused React components in the spec 025/026 chore.

## License

AGPL-3.0-or-later
