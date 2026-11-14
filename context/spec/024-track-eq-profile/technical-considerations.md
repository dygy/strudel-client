# Technical Specification: A Track Recommends Its Listening EQ

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Claude (for the owner)

## 1. High-Level Technical Approach

A pure parser in `@strudel/equalizer` reads the first `// @eq-profile` line of a piece of code into a validated profile. A small module-level store in the website holds the profile of the code the main (speakers) REPL is playing: `afterEval` sets it, `onToggle(false)` clears it, the same two choke points `trackSwitch` uses to label what is playing. `EqualizerUI` (one component for desktop and compact) subscribes with `useSyncExternalStore`, renders a "Track recommends" block and applies it through the same setters every other control uses.

No audio-graph change, no saved-settings format change, no Worker or SSR change.

## 2. Proposed Solution & Implementation Plan

### 2.1 The parser (`packages/equalizer/profile.ts`, exported from `index.ts`)

`parseEqProfile(code: string): { profile: EqProfile | null; line: string | null; warning: string | null }`. It never throws. These are the exact reading rules (the producer, MIDI-grep, matches them):

1. **Line.** The code is split on `\n` (a trailing `\r` is dropped). The first line matching `^\s*//\s*@eq-profile(\s+(.*))?$` is the profile line: a line comment at the start of the line, the token `@eq-profile` followed by whitespace or the end of the line. `foo() // @eq-profile …` and `// @eq-profiles …` do not match. Only the first matching line is read, even if it is invalid. No line → no profile, no warning.
2. **JSON.** The rest of the line, trimmed, must be a JSON object (not an array, not `null`). Otherwise: ignored, warning.
3. **Version.** `v` must be the number `1`. Otherwise: ignored, warning.
4. **`preset`.** Absent or `null` → none. A string that is a key of `EQUALIZER_PRESETS` → that preset. Any other value → treated as none, with a warning (the profile is still used if it has bands).
5. **`bands`.** Absent or `null` → none. Otherwise an array of exactly 10 objects, one per band frequency `31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000` (exact numbers, each once, any order; they are sorted). Each `gain` is a finite number in −24…+24 dB; `Q`, if present, a finite number in 0.5…4. Any violation → the whole profile is ignored, warning.
6. **Nothing to apply.** No bands and no known preset → ignored, warning.
7. **Cuts and output, with bands.** `lowCut` / `highCut`: absent or `null` → off; otherwise `{ "enabled": boolean, "frequency": number }` with the frequency in 20…1000 Hz (low) or 1000…20000 Hz (high); `frequency` may be left out or `null` when `enabled` is `false`. `outputGain`: absent or `null` → 0 dB; otherwise a finite number in −24…+6 dB. Any violation → the whole profile is ignored, warning.
8. **Cuts and output, without bands.** The profile is the preset: `lowCut`, `highCut` and `outputGain` are not read, and the preset's own values apply (as in the picker).
9. **`why`, `basis`.** Strings, trimmed, at most 300 characters counted in Unicode code points, as Python's `len()` counts (longer is cut to 299 code points plus `…`). Any other type or an empty string → absent. Never an error.
10. **Other keys** are ignored, so later versions can add fields within `v: 1`.

The ranges are the ones `persistence.ts` validates and `AudioEqualizer` accepts (`EQ_GAIN_LIMIT`, `EQ_Q_RANGE`, `LOW_CUT_RANGE`, `HIGH_CUT_RANGE`, `OUTPUT_GAIN_RANGE`). Out-of-range values are rejected, not clamped, as `loadEqualizerSettings` does: a clamped recommendation would not be what the producer measured.

Also in `profile.ts`:
- `resolveEqProfile(profile, current)` → `{ preset, bands, lowCut, highCut, outputGain }`, the settings Apply sets. With bands: the profile's gains (Q from the profile, else the current band's Q), cuts off keeping the current frequency when absent, output 0 dB when absent. Without bands: the preset's values exactly as `handlePresetChange` / `AudioEqualizer.applyPreset` set them. `preset` is `matchingPreset(settings, profile.preset)` or `'custom'`.
- `matchingPreset(settings, preferred)`: the preferred key first, then every preset in `EQUALIZER_PRESETS` order. A preset matches when all 10 gains are within 0.05 dB, each cut is on with the same frequency when the preset has it and off when it has none, and the output level matches (absent = 0).
- `sameEqSettings(a, b)`: the "Applied" check (gains and Q within 0.05, cuts' on/off, frequency when on, output).

### 2.2 The playing-profile store (`website/src/repl/playingEqProfile.ts`, new)

- `playingCodeEvaluated(code)`: parse; when the profile line is the same text as the one held, keep the held object (a stable `useSyncExternalStore` snapshot, and one warning per distinct broken line, not one per Ctrl+Enter). A broken line logs `console.warn('[EQ profile] …')`.
- `playingStopped()`: clear.
- `getPlayingEqProfile()`, `subscribePlayingEqProfile(listener)`, `resetPlayingEqProfile()` (tests).
- Wiring in `useReplContext.tsx`: `afterEval` → `playingCodeEvaluated(code)` (next to `trackSwitch.evaluated(code)`); `onToggle(false)` → `playingStopped()` (next to `trackSwitch.stopped()`). `afterEval` runs only for an evaluate that succeeded, so a failed evaluate keeps the playing track's profile, as the music does. The code passed to `afterEval` is the editor's text, comments included.

### 2.3 Panel (`EqualizerUI.tsx`, new `EqualizerRecommendation.tsx`, `EqualizerPresetDescription.tsx`)

- `EqualizerPresetDescription.tsx` exports `describeLines(t, settings)` (the regions/strip/flat lines it already builds); the description and the new block both use it.
- `EqualizerRecommendation` (props: the resolved settings, the preset key or null, `why`, `applied`, `isEnabled`, `compact`, `onApply`): `data-eq-recommendation`, a `<section>` labelled by its title (`aria-labelledby`, so its role is region); the preset line, the description lines, the why, the "Apply turns the EQ on" note while the EQ is off, and the button (`min-h-11` in compact). Rendered by `EqualizerUI` between the header and the preset picker, in both layouts.
- `handleApplyProfile` in `EqualizerUI`: compute `resolveEqProfile(profile, { bands, lowCut, highCut })`; on every EQ (main + preview) call `setBand(i, { gain, Q })`, `setLowCut`, `setHighCut`, `setOutputGain`, and then `setEnabled(true)` if it was off, so the values are stored silently first and the switch-on crossfade brings in the new curve (memory `eq-off-must-be-silent`); set the React state; `saveEqualizerSettings(settingsWith({ … , isEnabled: true, preset }))`.

### 2.4 i18n (9 × `website/src/i18n/locales/*/settings.json`)

`equalizerRecommendTitle` ("Track recommends"), `equalizerRecommendPreset` ("Preset: {{name}}"), `equalizerRecommendApply` ("Apply"), `equalizerRecommendApplied` ("Applied"), `equalizerRecommendTurnsOn` ("Apply also turns the EQ on"). The "why" label reuses `equalizerDescribeWhy`.

### 2.5 Owner and areas

The feature map assigns the equalizer package and the EQ panel to audio, and the REPL wiring to web; the change is small (one pure module, one store, one component, two wiring lines), so it is implemented in the main session (flow deviation, logged) and reviewed by one `strudel-reviewer`.

## 3. Impact and Risk Analysis

- **Data, runtime, upstream:** none. Browser-only; no Supabase, no Worker/SSR, no `@strudel/*` public behaviour change outside the fork's own `@strudel/equalizer` (additive exports).
- **Performance:** one line scan per evaluate; the JSON is parsed only when the line changed.
- **Audio:** Apply uses the existing glides. With the EQ off, the values are stored silently before `setEnabled(true)`.
- **MCP server (functional §3, optional item skipped):** reporting `eqProfile` from `get_track` / `check_code` would need a new allowed import in the Worker's bundle rules (`bundleRules.test.ts` allows only acorn, krill and a few pure site files), the 755-line preset table in a Worker that has a 10 ms CPU budget (memory `mcp-server-018`), an output-schema change on two tools with their conformance tests, and a separate Worker deploy. It is left out; `parseEqProfile` imports only the preset table and constants, so it can be added later.
- **Two `useReplContext` mounts:** the store is module-level; only the editor that evaluates calls it.

## 4. Testing Strategy

- **Unit** `packages/equalizer/test/profile.test.ts`: every rule in §2.1, including malformed JSON, `v` ≠ 1, out-of-range gain/Q/cut/output, 9 or 11 bands, a duplicate or unknown frequency, an unknown preset with and without bands, a trailing comment, `@eq-profiles`, two lines, CRLF, `why` cut at 300; `resolveEqProfile` and `matchingPreset`.
- **Store** `website/src/repl/__tests__/playingEqProfile.test.ts`: evaluated/stopped, stable snapshot, one warning per distinct broken line; wiring checked in the `useReplContext` source (the `scratchReplWiring` seam).
- **Panel** `website/src/repl/components/panel/__tests__/EqualizerRecommendation024.test.tsx`: hidden without a profile; title, preset, description, why and Apply on desktop and compact; the EQ unchanged until Apply; Apply sets both EQs and saves (reload loads it); Automotivo vs Custom; preset-only = picking the preset; Apply while off (silent until on, then on); Applied/Apply again after an edit; disappears on stop; Russian.
- **i18n:** `localeCompleteness.test.ts` covers the 5 keys in all 9 locales.
- **Browser:** the dev server, a track with a profile line, desktop and compact, Apply; screenshots to `docs/screenshots/024-*.png`.
