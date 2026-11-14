# Technical Considerations: 028

- `packages/equalizer/userPresets.ts`, pure: `loadUserPresets()`, `saveUserPreset(name, settings, {overwrite})`, `renameUserPreset`, `deleteUserPreset`, and `validateName`. It validates each entry through `validateEqualizerSettings` (spec 026), skips damaged entries, and caps at 50. Export from `index.ts`, with JSDoc.
- Panel:
  - `EqualizerUI.tsx` and `EqualizerListeningControls.tsx`, or a new `EqualizerUserPresets.tsx`: Save as…, rename, overwrite, and delete with an inline confirm.
  - The picker gets an optgroup "My presets" first. The value is prefixed `user:` so it can't collide with built-in keys.
  - Applying a preset reuses the existing apply path, which glides and writes the active slot.
- i18n keys in 9 locales: `equalizerMyPresets`, `equalizerSaveAs`, `equalizerPresetName`, `equalizerRename`, `equalizerOverwrite`, `equalizerDelete`, `equalizerDeleteConfirm`, `equalizerNameTaken`, `equalizerNameInvalid`, `equalizerPresetsFull`.
- Audio graph: no change.
- Upstream impact: none.
