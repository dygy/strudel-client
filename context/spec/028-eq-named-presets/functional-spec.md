# Functional Specification: Named EQ Presets

- **Roadmap Item:** Not on the roadmap. The owner asked for this on 2026-11-14 ("go do all please") from the list of improvements after 026. No GitHub issue.
- **Status:** Approved
- **Author:** Claude (for the owner)

## 1. Why

The EQ has 81 built-in presets and two A/B slots, but there's no way to keep your own setting under a name. A sound the owner tuned for one track is lost as soon as both slots are reused.

## 2. Requirements

- **Save as…** in the EQ panel saves the active slot's full settings under a name the user types: bands, cuts, output and bypass.
- Saved presets appear in the preset picker in their own group, **My presets**, listed first and sorted by name. Picking one applies it to the active slot with the usual glide.
- A saved preset can be **renamed**, **overwritten** with the current settings, or **deleted**. Delete asks for confirmation inside the panel, never with a browser dialog.
- Names are trimmed and 1–40 characters long. A name that is already taken asks before overwriting it. The limit is 50 presets.
- Presets are stored on this device (localStorage `strudel-eq-user-presets`). A damaged entry is skipped and the rest still load.
- It works on desktop and compact. The new strings are in all 9 languages.
- **Unsaved work, logged out, admin:** this is a device setting. It touches no tracks, works the same logged in or out, and doesn't affect the admin view.

### Acceptance Criteria
- [ ] Given a tuned EQ, when the user saves it as "Phonk car" and reloads, then "Phonk car" is under My presets, and picking it restores exactly those settings.
- [ ] When the user renames, overwrites or deletes a preset, then the picker reflects it and it survives a reload. Delete asks first, inside the panel.
- [ ] A duplicate name asks before overwriting. An empty name or one longer than 40 characters is refused. The 51st preset is refused with a message.
- [ ] A damaged stored entry is skipped, and the valid ones still load.
- [ ] Picking a user preset glides with no click, and goes into the active A/B slot only.
- [ ] In each of the 9 languages, the new controls show in that language.

## 3. Out of scope
Cloud sync of presets, sharing them, and import/export.
