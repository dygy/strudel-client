# Functional Specification: MIDI Learn for the Brake and Spin-up Sliders

- **Roadmap Item:** Not on the roadmap. It follows spec [025](../025-scratch-feel-controls/). The owner asked for this on 2026-11-14 ("go do all please"). No GitHub issue.
- **Status:** Approved
- **Author:** Claude (for the owner)

## 1. Why

Turntables have physical start and brake knobs. The owner already learns a MIDI jog wheel for the platter (spec 019), so the Brake and Spin-up sliders should take a knob too.

## 2. Requirements

- Next to each of the Brake and Spin-up sliders, a **Learn** button waits up to 10 s for a MIDI control change. The first CC that moves becomes that slider's knob. Esc or a second press cancels.
- A learned knob moves its slider across the whole range: CC value 0 is the minimum and 127 is the maximum. The mapping is logarithmic, so the short times get more resolution. The value is saved like a slider move (spec 025).
- **Forget** removes a learned mapping. Mappings are remembered on this device (localStorage `strudel-scratch-feel-midi`). A learned CC that the jog wheel also uses is refused with a message.
- A knob change during a scratch applies from the next grab or release, as in spec 025.
- Without Web MIDI, the Learn buttons are hidden, as the jog's are.
- The new strings are in all 9 languages.
- **Unsaved work, logged out, admin:** this is a device setting. It touches no tracks, works the same logged in or out, and doesn't affect the admin view.

### Acceptance Criteria
- [ ] Given Learn is pressed on Brake, when CC 21 moves, then CC 21 drives Brake: value 0 gives 0.02 s, 127 gives 1.0 s, and values in between follow a log curve.
- [ ] A learned mapping survives a reload. Forget removes it.
- [ ] Learn times out after 10 s, or is cancelled with Esc, and keeps the previous mapping.
- [ ] A CC already used by the jog wheel, or by the other slider, is refused with a message.
- [ ] Without Web MIDI, the Learn buttons don't show.
- [ ] In each of the 9 languages, the new controls show in that language.

## 3. Out of scope
MIDI output feedback (motorised knobs), MIDI for the Snap choice, and per-deck mappings.
