# Flow log — 023 vinyl scratch realism

## 2026-11-13 — spec, tech, tasks
- The owner's feedback on 019: no inertia, the sound doesn't follow the hand, the track doesn't move after release. The owner chose "like vinyl, with quantize".
- Root causes, verified by reading `scratchDsp.mjs`:
  - `grab()` freezes the ring and pins position 0 to the grab moment, so a forward push is clamped and silent;
  - the 10 ms mix gives no brake or spin-up;
  - release crossfades back to the unshifted live input.
- Spec, tech and tasks were written inline. Number 022 was taken by another session's `set-playlist` (6cc8e17 on local main, not pushed).
- Next: one `strudel-audio-engineer` dispatch (slices 1–3), in parallel with spec 021's engineer (disjoint files).
