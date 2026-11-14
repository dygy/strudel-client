# @strudel/mixer

Audio mixing for the strudel-client fork. The package exists only in this fork and is not published.

## What's in it

- **`PreviewEngine`** (spec 006): a second Strudel engine with its own `AudioContext`, for the headphone preview. It has its own output device and its own EQ instance, driven by the EQ panel.
- **`TrackTransitionController`** and **`buildTransition`** (spec 017): track switches made at the pattern level (cut, crossfade, filter sweep and the rest), with tempo glide and loudness matching (`transitions/loudness.mjs`).
- **Vinyl scratch** (specs 019, 023, 025) in `scratch/`:
  - `ScratchDeck`, which wraps the `scratch-processor` AudioWorklet;
  - `ScratchController`, the per-deck inputs;
  - `midiJog`, MIDI jog wheels;
  - `scratchPhysics`, the brake, motor and snap grid, shared by the worklet and the on-screen platter;
  - `ScratchShift`, the pattern offset and the hand-over after a release.

The speakers' EQ is not in this package. It is `@strudel/equalizer`, installed on superdough's output insert by `website/src/repl/mainEqualizer.ts`.

## History

Spec 006 first built a dual-stream `AudioMixer` (`AudioStream`, `TransitionMixer`, `ErrorNotifier`, `KeyboardShortcutManager`). The app never constructed it, because `PreviewEngine` took its place, so it was removed with its unused React components in the spec 025/026 chore.

## License

AGPL-3.0-or-later
