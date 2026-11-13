# Technical Specification: EQ Genre Presets for Every Family, and What Each Preset Does

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Approved
- **Author(s):** Claude (for the owner)

## 1. High-Level Technical Approach

This is data plus UI only. It adds a `family` to the genre presets, adds 47 preset entries, adds a pure function that summarises any EQ settings into region deltas, and renders that summary (localised) plus a per-preset "why" key under the picker.

There is no audio-graph change, so spec 020's chain, persistence shape and storage key stay the same.

## 2. Proposed Solution & Implementation Plan

### 2.1 Presets (`packages/equalizer/presets.ts`)

- `EqualizerPreset` gains `family?: 'brazilianLatin' | 'phonkHipHop' | 'electronic' | 'liveOther'`. It is required when `group === 'genre'` and enforced by a test.
- The existing 12 keep their keys and values and are assigned to families as the functional spec §2.1 lists them.
- The 47 new keys are camelCase:
  - **brazilianLatin:** `bruxaria`, `mandelaoSlowed`, `funkCariocaOldSchool`, `baileFunk`, `reggaeton`, `dembow`, `cumbia`, `afroHouse`, `amapiano`
  - **phonkHipHop:** `brazilianPhonk`, `housePhonk`, `memphis`, `boomBap`, `lofiHipHop`, `ukDrill`, `nyDrill`, `rage`, `plugg`, `cloudRap`, `jerseyClub`
  - **electronic:** `house`, `deepHouse`, `techHouse`, `minimal`, `hardTechno`, `trance`, `psytrance`, `hardstyle`, `gabber`, `ukGarage`, `jungle`, `breakbeat`, `synthwave`, `hyperpop`, `futureBass`, `riddim`
  - **liveOther:** `rock`, `metal`, `punk`, `usFunk`, `disco`, `soul`, `reggae`, `dub`, `ambient`, `chillout`, `lofi`
- Collisions: profile presets already use `rock`, `electronic`, `hipHop`, `deep`, `dance`, `latin`… so the implementer checks every new key against the existing ones. A colliding genre key gets a `Genre` suffix (e.g. `rockGenre`). Existing keys are never renamed, because saved selections use them.
- The values are designed per genre within spec 020's ranges. The loudness vs Flat must stay within ±3 dB, enforced by the existing pink-noise helper test over **all** genre presets.

### 2.2 Summary (`packages/equalizer/describe.ts`, new, exported from `index.ts`)

```
describeSettings({ bands, lowCut, highCut, outputGain })
  → { flat: boolean,
      regions: { region, dB }[],
      lowCut?: Hz,
      highCut?: Hz,
      outputGain?: dB }
```

- **Regions:** sub (31, 62 Hz), bass (125), lowMid (250, 500), mid (1k, 2k), presence (4k), air (8k, 16k). Each region's dB is the mean of its bands' gains, rounded to the nearest dB.
- A region is included when |dB| ≥ 2. The output is included when it is not 0.
- `flat` is true when no region is included, the cuts are off and the output is 0.
- The function returns data only, with no strings, so localisation stays in the website.

### 2.3 Panel (`EqualizerUI.tsx`, `EqualizerStripControls.tsx` or a new `EqualizerPresetDescription.tsx`, `EqualizerCompact.tsx`)

- **Picker:** the optgroups become the 4 families in the spec order, then Profiles. Presets are ordered within a family as listed in the functional spec.
- **Description:** renders `describeSettings(current state)` with i18n templates. Examples: "Sub +16 dB · Low-mids −4 dB · Presence +7 dB", "Low cut 25 Hz · High cut 14 kHz · Output −8 dB", and "No change: flat".
- **The "why" line** is `equalizerWhy<Key>` and is shown only while a genre preset is active (not Custom).
- It is shown in both the desktop and the compact layout, with `aria-live="polite"` on the description.

### 2.4 i18n (9 × `website/src/i18n/locales/*/settings.json`)

| Kind | Count | Keys |
|---|---|---|
| Preset names | 47 | `equalizerPreset<Key>` |
| "Why" sentences | 59 | `equalizerWhy<Key>`, the 12 existing genres + the 47 new ones |
| Family labels | 4 | `equalizerFamily<Family>` |
| Region labels and templates | — | `equalizerRegionSub` … `equalizerRegionAir`, `equalizerDescribeLowCut`, `…HighCut`, `…Output`, `…Flat`, `equalizerDescribeTitle` |

Updated: `equalizerSubtitle` (81 presets). The old `equalizerGroupGenres` stays as is (it may become unused; keep it, since the i18n tests may reference it).

The "why" sentences are written fresh in each language (≤ 120 characters), not machine-literal.

### 2.5 Owner and areas

The audio specialist owns the equalizer package plus the EQ panel and its i18n (per the feature map), so there is **one `strudel-audio-engineer` dispatch**, followed by **one `strudel-test-engineer` dispatch** for acceptance mapping.

## 3. Impact and Risk Analysis

- **Data, runtime and upstream:** none. The changes are browser-only, there is no Worker or SSR change, and the bundle grows by about 9 locales × ~110 strings (a few KB), with no effect on the Worker size limit.
- **Saved selections:** existing keys are unchanged. The persistence loader maps unknown preset names to custom; new keys must be in `EQUALIZER_PRESETS` before any save could reference them, and they are.
- **Key collisions with profile presets:** see §2.1, enforced by a test.
- **Translation quality** for 59 "why" sentences × 9 languages: genre names stay untranslated; the owner can spot-check the ru and en screenshots.

## 4. Testing Strategy

- **Unit (`packages/equalizer/test/`):**
  - every genre preset has a family, and the family membership and order match the spec lists;
  - unique keys, and existing keys and values unchanged (snapshot of the 34 from spec 020);
  - all values are within spec 020 ranges, and the loudness of every genre preset is within ±3 dB of Flat;
  - `describeSettings`: the region means, the ≥2 dB threshold, cut and output inclusion, flat detection, rounding.
- **Panel:**
  - the 5 optgroups in order with their exact members;
  - picking a preset shows the summary and the "why";
  - a manual edit gives Custom, the "why" is hidden and the summary updates;
  - Flat shows "No change: flat";
  - the compact layout shows the description;
  - a language switch changes the text.
- **i18n completeness:** every name, why, family and region key exists and is non-empty in all 9 locales.
- **Browser:** render the desktop and compact panel with Drift Phonk and Amapiano, in en, ru and an RTL locale (ar or he), and save screenshots to `docs/screenshots/021-*.png`.
