# Tasks: Vinyl Scratch Control (019)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

**Order and blocker:** Slices 1 and 2 (except task 2.1) have no dependencies. Task 2.1, the superdough slot, waits for the spec 008 EQ fix commit, because both touch `packages/superdough/superdoughoutput.mjs`. Rebase on that commit before starting 2.1. Slices 3–5 consume the audio API from slices 1–2.

- [x] **Slice 1: Scratch DSP and worklet work offline (pure, tested)**
  - [x] 1.1 `packages/mixer/scratch/scratchDsp.mjs`. The work:
    - The ring buffer per channel (8 s), `freeze` / `unfreeze`.
    - `targetPos` / `pos` with the one-pole smoother, motor mode and clamping to [−8 s, 0] with silent edges.
    - Interpolated read, stylus-velocity gain, DC blocker, and a 10 ms linear `mix` ramp.
    - NaN / ∞ guards and an 8× rate clamp.

    JSDoc on all exports (tech §2.2). **[Agent: strudel-audio-engineer]**
  - [x] 1.2 `packages/mixer/scratch/scratchProcessor.mjs`: the `scratch-processor` that wraps the DSP; handles the port messages `grab`, `move`, `motor` and `release`. Also a Blob-URL loader cached per `AudioContext`, following the `superdough/dspworklet.mjs` pattern (tech §2.3). **[Agent: strudel-audio-engineer]**
  - [x] 1.3 Unit tests in `packages/mixer/test/scratchDsp.test.mjs`. They must check:
    - Idle pass-through is bit-exact.
    - The grab ramp reaches 1 within 10 ms with no step bigger than one ramp increment.
    - Reverse playback matches the reversed input.
    - Standstill RMS is ≈ 0.
    - Both edges are silent.
    - Release is continuous.
    - The guards work.
    - Negative pairs: no grab means no change; release without a grab is a no-op.

    Prove RED→GREEN. **[Agent: strudel-audio-engineer]**
  - Verify: `pnpm exec vitest run packages/mixer/test/scratchDsp.test.mjs` is green, with output quoted.

- [x] **Slice 2: A deck can be scratched in code on both engines**
  - [x] 2.1 **(blocked on the spec 008 commit)** `packages/superdough/superdoughoutput.mjs`:
    - `SuperdoughOutput.setPreGainInsert(node|null)`, persisted across `reset()` / `initializeAudio()`.
    - `disconnect()` touches only the insert's own edges.
    - A pass-through on `SuperdoughAudioController`.
    - JSDoc that says "fork addition".
    - It coexists with the 008 post-gain insert (tech §2.1).

    Test `packages/superdough/test/preGainInsert.test.mjs`: wiring, surviving reset, `null` restoring the direct edge, coexistence with 008. **[Agent: strudel-audio-engineer]**
  - [x] 2.2 `packages/mixer/scratch/ScratchDeck.mjs` and `ScratchController.mjs`, as specified in tech §2.4:
    - `attach`, `grab`, `moveBy`, `setMotor`, `release` (idempotent), `destroy` (clears the slot and disconnects).
    - The controller with `{main, preview}`, `selected`, `releaseAll`, `autoRelease(ms)` and `change` events.
    - The platter mapping constants: 1.8 s per turn, wheel 0.06 s per notch.

    Export from `packages/mixer/index.mjs`, and add types to `website/src/types/strudel.d.ts`. Tests `packages/mixer/test/{ScratchDeck,ScratchController}.test.mjs` (Web Audio mock, explicit fake timers). **[Agent: strudel-audio-engineer]**
  - [x] 2.3 `packages/mixer/PreviewEngine.mjs`: create and attach a preview `ScratchDeck` on `initialize()` and destroy it in `destroy()`; expose it as `engine.scratchDeck`. **[Agent: strudel-audio-engineer]**
  - Verify: the vitest files above are green; the whole suite has no new failures.

- [x] **Slice 3: The user scratches the main deck from Mixer settings (mouse, touch, wheel)**
  - [x] 3.1 `website/src/repl/scratch/scratchRuntime.ts`:
    - The `ScratchController` singleton and the `$scratch` nanostore (`grabbed`, `selected`, `previewAvailable`, `playing`).
    - Attach the main deck after `initAudio` in `website/src/repl/useReplContext.tsx`, next to the PreviewEngine init.
    - Attach and detach the preview deck with the PreviewEngine lifecycle.
    - Call `releaseAll()` before stop, before evaluate in `handleEvaluate`, and on `onToggle(false)` (tech §2.6).

    **[Agent: strudel-web-engineer]**
  - [x] 3.2 `website/src/repl/components/scratch/Platter.tsx`:
    - An SVG record that turns at 33⅓ rpm while the deck plays, and follows the pointer angle while grabbed.
    - Pointer capture and `touch-action:none`.
    - A non-passive wheel handler with `preventDefault` and auto-release after 250 ms.
    - Release on `pointerup`, `pointercancel` and `lostpointercapture`.
    - Dimmed and inert when the deck isn't playing.
    - A `size` prop.

    **[Agent: strudel-web-engineer]**
  - [x] 3.3 `website/src/repl/components/scratch/ScratchSection.tsx`, mounted in `panel/MixerSettings.tsx` in both branches (with and without a mixer):
    - The platter.
    - The deck switch Speakers / Headphones. Headphones is disabled without the preview.
    - A shortcut hint.

    Setting `scratchDeck` in `website/src/settings.ts` (string-safe after reload). **[Agent: strudel-web-engineer]**
  - [x] 3.4 i18n: the section, deck, hint and MIDI strings in `website/src/i18n/locales/{ar,en,es,fr,he,ko,ru,sr,zh}/settings.json`. **[Agent: strudel-web-engineer]**
  - Verify (browser, `pnpm dev`):
    - Play a pattern, then drag the platter backwards. The worklet test hook reports `mix` → 1 within 15 ms and reverse reads.
    - On release, `mix` → 0.
    - The console is clean.

- [x] **Slice 4: Scratch is at hand while playing (header and compact button, keyboard)**
  - [x] 4.1 `website/src/repl/components/scratch/ScratchButton.tsx`: a popover with `Platter`, closed by an outside click or Escape, with a `touch` variant. Mount it in `components/Header.tsx` and `compact/CompactControlBar.tsx` beside `TransitionPicker`. **[Agent: strudel-web-engineer]**
  - [x] 4.2 The shortcut in `useReplContext.tsx`:
    - Alt+Shift+ArrowLeft/Right → `grab` plus `setMotor(∓1)`, ignoring `event.repeat`.
    - Release on keyup and on window `blur`.
    - **Not handled** while focus is inside `.cm-editor` or an input or textarea.

    Add the row to `panel/ShortcutsTab.tsx` and `i18n/locales/*/shortcuts.json` (all 9 locales). **[Agent: strudel-web-engineer]**
  - Verify (browser): the popover opens and closes on desktop and at phone width. Holding Alt+Shift+← with the editor unfocused scratches (`mix` 1); with the editor focused it does not.

- [x] **Slice 5: The MIDI jog wheel scratches**
  - [x] 5.1 `packages/mixer/scratch/midiJog.mjs`:
    - `decodeRelativeCC` (two's complement, plus binary offset detected during Learn).
    - An adapter on `@strudel/midi` (`enableWebMidi`, `WebMidi.inputs`, `controlchange`).
    - Learn: ≥3 messages in 300 ms, with a 10 s timeout that keeps the old mapping.
    - Mapping in `localStorage` `strudel:scratch:midi` (try/catch).
    - Any jog message grabs, moves, then arms `autoRelease(250)`.
    - An `unavailable` state with a reason.

    Add `@strudel/midi` as a workspace dependency of `@strudel/mixer`, imported lazily. Test `packages/mixer/test/midiJog.test.mjs`. **[Agent: strudel-audio-engineer]**
  - [x] 5.2 Learn and Forget in `ScratchSection.tsx`: status (controller name and control); Learn disabled with an explanatory note when MIDI is unavailable or access is denied. **[Agent: strudel-web-engineer]**
  - Verify: the midiJog tests are green; in the browser without MIDI, Learn is disabled with the note.

- [x] **Slice 6: Feature Testing**
  - [x] 6.1 Website tests:
    - `components/scratch/__tests__/{Platter,ScratchSection,ScratchButton}.test.tsx`: angle → `moveBy`, wheel `preventDefault` and auto-release, pointercancel release, deck switch disabled without preview, popover Escape / outside click, compact variant.
    - `repl/__tests__/scratchShortcut.test.ts`: grab and keyup release, blur release, ignored in the editor or an input (negative pair).
    - `i18n/__tests__/scratchKeys.test.ts`: all 9 locales have every key.

    RED-validated. **[Agent: strudel-test-engineer]**
  - [x] 6.2 Acceptance coverage map: map every functional-spec criterion to a test or a named browser check, and list the gaps. **[Agent: strudel-test-engineer]**
  - Verify: the whole suite has no new failures against `known-red-tests.txt`, and also passes with `--maxWorkers=2` and on Node 24.12.0.

- [x] **Slice 7: Bookkeeping**
  - [x] 7.1 Add a `context/product/feature-map.md` row: "Vinyl scratch control" with code paths, spec 019, tests, owner audio (UI: web). Inline.
  - [x] 7.2 Check that the i18n strings exist in all 9 locales (covered by 6.1). There is no migration file (no schema change). Inline.
  - [x] 7.3 Roadmap entry ticked and spec Status set to Completed after prod verification (/ship Step 11). Inline.
