# Technical Specification: Strong EQ Control: Wider Range, Low/High Cut, Genre Presets

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Approved
- **Author(s):** Claude (for the owner)

---

## 1. High-Level Technical Approach

Everything happens in the browser. The work is in the fork-only `@strudel/equalizer` package and the EQ panel; superdough, the Worker, Supabase and the API are untouched.

`AudioEqualizer` grows from a chain of 10 bands into a full channel strip:

```
input ─┬─ dryGain ───────────────────────────────────────────────────────┬─ output
       └─ lowCut(2× highpass) → 10 bands → highCut(2× lowpass) → outputGain → limiter → wetGain ─┘
```

- **On/off** crossfades `wetGain` and `dryGain`. Off is a true bypass: the dry path carries the signal and the wet path (including the limiter) is not heard.
- **The wet chain keeps the existing rule:** a setting is always stored, but applied only while the EQ is on (memory `eq-off-must-be-silent`). Every parameter change glides; nothing jumps.
- **Both instances get the change for free:** the main speakers EQ (`website/src/repl/mainEqualizer.ts`) and the preview EQ (`packages/mixer/PreviewEngine.mjs`) are both `AudioEqualizer`s fed through `applyEqualizerSettings`.

Presets become full settings: bands, cuts and output level. A `group` field separates genre presets from listening profiles.

Persistence gains optional fields. Old saves are missing them and load with the defaults: cuts off, output 0 dB.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Audio graph (`packages/equalizer/AudioEqualizer.ts`)

| Node | Type / settings | Notes |
|---|---|---|
| `dryGain`, `wetGain` | GainNode | On/off crossfade over ~20 ms (`setTargetAtTime`, τ ≈ 5 ms). Initial: wet 1, dry 0 when enabled. |
| `lowCut` | 2 × BiquadFilter `highpass`, Q 0.541 and 1.307 | A 4th-order Butterworth, so 24 dB/oct with no peak. Off = frequency 10 Hz (inaudible) and flagged off in config. Range 20–1000 Hz. |
| 10 bands | unchanged types and frequencies | Gain clamp becomes **±24 dB**. Q stays 0.5–4. |
| `highCut` | 2 × BiquadFilter `lowpass`, same Qs | Off = frequency `min(22000, nyquist·0.95)`. Range 1000–20000 Hz. |
| `outputGain` | GainNode | −24 to +6 dB, converted dB→linear, glides. |
| `limiter` | DynamicsCompressorNode | threshold −1 dB, knee 0, ratio 20, attack 0.002 s, release 0.1 s. In the wet path only. |

Channel count mode stays the default `'max'` on every node, so a multichannel merger is not downmixed (see the 008 fix).

**Cut frequency glide:** use `setTargetAtTime` on `frequency` (τ ≈ 10 ms). A sweep made while playing must not produce zipper noise.

**New public API**, each with JSDoc:
- `setLowCut({ enabled?, frequency? })`
- `setHighCut({ enabled?, frequency? })`
- `setOutputGain(dB)`
- `getLimiterReduction(): number` (dB; reads `limiter.reduction`)

Each one clamps its input, ignores non-finite values with a warning (same style as `setBand`), stores always, and applies only while enabled. `setEnabled(true)` re-applies the stored state; `setEnabled(false)` crossfades to dry.

**Other changes:**
- `getState()`/`setState()` cover the new fields.
- `applyPreset(name)` applies bands, cuts and output. For a profile preset, the cuts are off and the output is 0 dB.
- `getFrequencyResponse()` includes the cut filters and the output gain, so the chart shows the cuts.
- `destroy()` disconnects every node it created.

### 2.2 Presets (`packages/equalizer/presets.ts`)

`EqualizerPreset` becomes `{ name, group: 'profile' | 'genre', gains: number[10], lowCut?: number | null, highCut?: number | null, outputGain?: number }`. The 22 existing presets get `group: 'profile'`, and their values are unchanged.

There are 12 new `group: 'genre'` presets. The keys are camelCase:

`brazilianFunk`, `automotivo`, `montagem`, `funkAgressivo`, `mandelao`, `phonk`, `driftPhonk`, `electro`, `techno`, `drumAndBass`, `dubstep`, `trap`

The implementer designs the values from each genre's character. Examples:
- **automotivo/montagem:** heavy sub (+15…+24 at 31/62 Hz), scooped low-mids, hard top.
- **phonk/drift phonk:** big 808 sub, cowbell presence around 2–4 kHz, high cut ~12–14 kHz for the lo-fi edge.
- **dnb:** low cut ~30 Hz, sub and snap.

Each genre preset's `outputGain` is set so its loudness matches Flat within ±3 dB. This is measured, not guessed: render pink noise through the EQ chain in an `OfflineAudioContext`, or compute the energy-weighted response from `getFrequencyResponse` over a pink spectrum, and compare RMS against flat.

### 2.3 Persistence (`packages/equalizer/persistence.ts`)

`EqualizerSettings` gains optional `lowCut: { enabled: boolean; frequency: number }`, `highCut` (same shape) and `outputGain: number`.

Validation in the loader:
- Band gain is accepted in ±24 (Q unchanged).
- The `lowCut` frequency must be in 20–1000 and the `highCut` frequency in 1000–20000.
- `outputGain` must be in −24…+6.
- A field that is present but invalid means the whole save is damaged, so the EQ starts flat (same policy as today).
- A missing field gets its default: cut off at 80 Hz / 12000 Hz, output 0.

`applyEqualizerSettings` applies on/off first, then bands, cuts and output. `getDefaultSettings` includes the new fields. Update the memory note's ranges afterwards, because they are documented there.

The storage key is unchanged: old saves are a subset of the new shape.

### 2.4 Panel (`website/src/repl/components/panel/EqualizerUI.tsx`, `EqualizerCompact.tsx`)

**Constants and chart:**
- `EQ_GAIN_MIN/MAX` become ±24 (`EqualizerCompact.tsx`); the clamp helpers follow.
- The chart's dB scale goes to ±24, with grid lines every 6 dB.

**Desktop controls:**
- Low cut and high cut: each has an on/off toggle and a log-scale frequency slider showing a value like "200 Hz" / "2.0 kHz".
- Output level: a slider from −24 to +6 dB.
- Limiting indicator: polled with `requestAnimationFrame` from the **main** EQ's `getLimiterReduction()` while the panel is visible. It is lit when the reduction is past −1 dB, and the polling stops on unmount.

**Compact (touch) layout:** the same controls fit the compact rules from spec 016 (memory `responsive-compact-layout`), with ≥44 px touch targets.

**Preset select:** two `<optgroup>`s, Genres and Profiles.

**Shared state:**
- One state object drives both EQs through `equalizers()`.
- Saves go through `saveEqualizerSettings` with the new fields.
- Any manual change makes the preset `custom`.

### 2.5 i18n (`website/src/i18n/locales/{en,ru,es,fr,ar,he,zh,ko,sr}/settings.json`)

New keys in all 9 locales:
- `equalizerPreset<Key>` for the 12 genres, where genre names may stay untranslated.
- `equalizerLowCut`, `equalizerHighCut`, `equalizerCutOff` ("Off").
- `equalizerOutputLevel`, `equalizerLimiting`.
- `equalizerGroupGenres`, `equalizerGroupProfiles`.

Updated keys: `equalizerRange` (±24 dB) and `equalizerSubtitle` (34 presets).

### 2.6 Areas and owner

- **Audio** (`strudel-audio-engineer`): `packages/equalizer/*`, `packages/mixer/PreviewEngine.mjs` (likely no change, since it goes through `applyEqualizerSettings`), the EQ panel and compact EQ (the feature map says EQ/mixer UI is owned by audio), and the i18n keys.
- **Tests** (`strudel-test-engineer`): the acceptance-level tests listed in §4.

---

## 3. Impact and Risk Analysis

- **Data:** no Supabase, schema, migration or RLS change. Only the local storage shape grows, and the change is backwards-compatible.
- **Runtime:** browser only. No SSR or Worker change, no env vars or secrets. Worker size is unaffected.
- **Upstream:** none. `@strudel/equalizer` and `@strudel/mixer` are fork packages, and superdough is untouched.
- **Clicks on toggle (dry/wet crossfade):** wet and dry are coherent, but they differ in phase and in limiter lookahead (~6 ms), so a 20 ms crossfade can comb briefly. *Mitigation:* keep the crossfade short and equal-gain, and measure in a browser that there is no step in RMS.
- **The limiter colours the flat sound:** at threshold −1 dB a loud master could already be limited at flat settings. *Mitigation:* §2.3 of the functional spec ("flat + on ≈ off") is measured. If the limiter acts at flat, raise the threshold to −0.3 dB, or enable the limiter only when a boost or output > 0 dB exists. Record the decision in the flow log.
- **CPU:** 4 extra biquads, 1 compressor and 3 gains per EQ, two EQs in total. This is negligible.
- **±24 dB band boost plus the limiter pumps:** this is expected for an extreme setting. Presets keep their loudness matched to Flat, so they don't pump hard.
- **Saved-settings loader:** if the save format changes again, update the loader ranges, or real saves reset to flat (the trap is recorded in memory).

---

## 4. Testing Strategy

**Unit tests** (`packages/equalizer/test/*`, vitest + `packages/mixer/test/webAudioMock.mjs`, extended with BiquadFilter `type`/`frequency` and DynamicsCompressor):
- ±24 dB clamp.
- The cut clamps (20–1000, 1000–20000) and their Off handling.
- Output clamp −24…+6.
- Off means dry 1 / wet 0, and settings changed while off are stored but not applied.
- `setEnabled(true)` restores the stored settings.
- `applyPreset` applies cuts and output, and a profile preset clears the cuts.
- Every genre preset is within range, and its loudness is within ±3 dB of Flat (pink-noise energy from `getFrequencyResponse`, which needs a real `getFrequencyResponse` or a computed biquad response; a pure-math helper is fine).
- `destroy()` disconnects all nodes.
- Glide: `setTargetAtTime` is used for gain, frequency and the wet/dry gains.

**Persistence tests:**
- An old save (±12, no new fields) loads with the defaults.
- A new save round-trips.
- Out-of-range new fields are treated as damaged and fall back to flat.

**Panel tests** (`website/src/repl/components/panel/__tests__/`):
- The slider reaches ±24.
- The cut toggle and slider reach both EQs.
- The output slider works.
- The limiting indicator shows when the mocked reduction is below −1.
- Presets in two groups; picking a genre preset sets the cuts, and editing afterwards shows Custom.
- The compact layout has the cuts.
- `i18n/__tests__`: every new key exists in all 9 locales.

**Browser measurement** (`pnpm dev`, real modules, AnalyserNode on the EQ output, the same method as the 008 fix):
- A low cut at 200 Hz drops 100 Hz by ≥ 20 dB.
- A high cut at 2 kHz drops 4 kHz by ≥ 20 dB.
- A +24 dB band with loud noise gives an output peak ≤ 0 dBFS and the indicator lights.
- Flat + on vs off differs by < 0.5 dB RMS.
- The on/off and preset switch show no RMS step greater than the target change.
