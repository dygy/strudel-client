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

## History

Spec 006 first built a dual-stream `AudioMixer` (`AudioStream`, `TransitionMixer`, `ErrorNotifier`, `KeyboardShortcutManager`). The app never constructed it, because `PreviewEngine` took its place, so it was removed with its unused React components in the spec 025/026 chore.

## License

AGPL-3.0-or-later
