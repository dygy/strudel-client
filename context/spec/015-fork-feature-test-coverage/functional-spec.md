# Functional Specification: Safety Net for the Untested Fork Features

- **Roadmap Item:** Phase 4: Make it safe to change → Coverage for untested fork features (smooth transitions, EQ, screen recorder, import, admin)
- **Status:** Completed
- **Author:** Dygy

---

## 1. Overview and Rationale (The "Why")

Five features this fork added have no automated checks: smooth transitions between tracks, the 10-band equalizer, the screen recorder, importing a library of patterns, and the admin view. Every deploy now refuses to go live when an automated check fails, but that only protects behaviour that has a check. For these five, the only safeguard today is someone noticing a breakage by ear or by eye, often during a live set. A regression in the update flow already reached production this way: Update restarted the track from the beginning, and nobody caught it until it was played.

This work adds an automated check for each important behaviour of the five features. **The product itself does not change.** Nothing new appears on screen, and nothing behaves differently. What changes is that breaking one of these behaviours later becomes impossible to deploy without someone noticing.

**Success looks like:**
- Every behaviour listed in Section 2 has at least one check that passes when the behaviour is correct, and at least one that fails when it is broken.
- Each check has been shown to fail when the behaviour it guards is deliberately broken, so no check passes regardless of the code.
- The full set of checks still passes, and deploys keep flowing.

---

## 2. Functional Requirements (The "What")

Each requirement describes behaviour the live coder relies on today, and that must stay true. "A check" means an automated check that runs before every deploy.

### 2.1 Smooth transitions between tracks

- **The transition settings the user picks are remembered and kept within sensible limits.** The fade length can be set between half a second and ten seconds. A value outside that range is pulled back to the nearest limit, and the on/off choice survives a page reload.
  - **Acceptance Criteria:**
    - [ ] When the user sets a fade length of 30 seconds and reloads the page, then the fade length shown is 10 seconds.
    - [ ] When the user sets a fade length of 0.1 seconds, then the fade length used is half a second.
    - [ ] When the user turns smooth transitions on and reloads the page, then smooth transitions are still on.
    - [ ] Given the saved settings are unreadable, when the page loads, then smooth transitions start switched off with a 2-second fade and no error is shown.
- **Volume always glides; it never jumps.** During a fade the volume moves gradually to silence and back up to full volume.
  - **Acceptance Criteria:**
    - [ ] When a transition fades out, then the volume reaches silence gradually over the chosen fade length, not in one step.
    - [ ] When a transition fades back in, then the volume returns gradually to full volume over the chosen fade length, not in one step.
- **Several quick track switches play only the latest one.** If the user switches tracks again while a fade is still running, the system waits for that fade to finish, then plays only the most recent choice.
  - **Acceptance Criteria:**
    - [ ] Given a fade is in progress, when the user switches tracks twice more, then only the last track chosen plays after the fade, and the middle one never plays.
- **A failed transition never leaves the user in silence.**
  - **Acceptance Criteria:**
    - [ ] Given a fade-out has started, when the new track fails to start, then the volume is restored to full volume immediately.

### 2.2 10-band equalizer

- **Each band changes only its own range of frequencies, by the amount the user sets, within the allowed limits.**
  - **Acceptance Criteria:**
    - [ ] When the user raises the 1 kHz band by 6 dB, then that band shows +6 dB and the other nine bands are unchanged.
    - [ ] When the user tries to set a band above +12 dB or below −12 dB, then the band stops at +12 dB or −12 dB.
- **Presets apply all ten bands at once.**
  - **Acceptance Criteria:**
    - [ ] When the user picks a preset, then all ten bands move to that preset's values.
    - [ ] When the user picks a preset name that does not exist, then the bands stay as they were.
- **EQ settings survive a reload, and damaged saved settings never break the app.**
  - **Acceptance Criteria:**
    - [ ] When the user shapes the EQ and reloads the page, then the same band values are restored.
    - [ ] Given the saved EQ settings are damaged, when the page loads, then the EQ starts flat and the app keeps working.
- **Switching the EQ off passes the sound through unchanged.**
  - **Acceptance Criteria:**
    - [ ] Given the bands are shaped, when the user switches the EQ off, then the sound passes through with no band applied, and when they switch it back on, then the same shape returns.
- **The EQ display labels frequencies the way musicians read them.**
  - **Acceptance Criteria:**
    - [ ] When the display shows 1000 Hz and 16000 Hz, then the labels read "1k" and "16k", and 63 Hz reads "63".

### 2.3 Screen recorder

- **Recording starts only after the user picks what to share, and stops cleanly.**
  - **Acceptance Criteria:**
    - [ ] When the user starts recording and picks a screen or tab, then recording begins and the recording indicator shows.
    - [ ] When the user starts recording and cancels the screen picker, then no recording starts, no error is shown, and the record button is ready again.
    - [ ] When the user stops recording, then a video file is offered for export, and the browser's screen-sharing indicator disappears.
- **Stopping sharing from the browser's own controls ends the recording properly.**
  - **Acceptance Criteria:**
    - [ ] Given a recording is running, when the user clicks the browser's "Stop sharing", then the recording ends and the video is still offered for export.
- **Recording works on browsers that support different video formats.**
  - **Acceptance Criteria:**
    - [ ] Given the browser cannot record the preferred video format, when the user starts recording, then a supported format is used instead and recording still works.
    - [ ] Given the browser supports no usable video format, when the user starts recording, then they see an error and nothing is left recording.

### 2.4 Importing a library

- **Only a signed-in user can import, and imported tracks always land in that user's own library.**
  - **Acceptance Criteria:**
    - [ ] Given the user is signed out, when an import is attempted, then it is refused and nothing is saved.
    - [ ] When a signed-in user imports tracks, then the tracks appear in their own library and in no one else's, even if the import claims to belong to another user.
- **A malformed import is refused, and nothing is saved.**
  - **Acceptance Criteria:**
    - [ ] When an import arrives that is not a list of tracks and folders, then it is refused with an "invalid data" error, and the user's library is unchanged.
- **An imported track never overwrites an existing one.** If a track with the same name (ignoring capitalisation) already exists in the same folder, the imported copy is saved with a number added: "Beat 2", then "Beat 3".
  - **Acceptance Criteria:**
    - [ ] Given the user already has "Beat" in a folder, when they import a track called "beat" into that folder, then their original "Beat" is unchanged and the import appears as "beat 2".
    - [ ] When the user imports two tracks with the same name into the same folder, then they appear as "Beat" and "Beat 2".

### 2.5 Admin view

- **Only the admin account can see the admin overview of all users.**
  - **Acceptance Criteria:**
    - [ ] Given the user is signed out, when they open the admin overview, then they are refused and see no user data.
    - [ ] Given the user is signed in with a normal account, when they open the admin overview, then they are refused and see no user data.
    - [ ] Given the user is signed in as the admin, when they open the admin overview, then they see the list of users and their tracks.
    - [ ] When someone signs in with an address that differs from the admin address in any way, including capitalisation, then they are refused.

---

## 3. Scope and Boundaries

### In-Scope

- Automated checks for every behaviour in Section 2, each shown to fail when its behaviour is deliberately broken.
- Updating the feature inventory so each of the five features lists the checks that now guard it.
- Recording any behaviour found to be broken today as a finding in this spec, with a follow-up roadmap item.

### Out-of-Scope

- **Any change to what the user sees or hears.** This work changes no screen, sound, message or translation. It does not touch unsaved work, sign-in behaviour, the admin read-only view, or any of the 9 languages.
- **Fixing bugs the checks uncover.** Each one is recorded under "Findings" below and becomes its own follow-up roadmap item, with its own spec.
- **Browser-level end-to-end testing** (driving a real browser through these flows).
- **The on-screen import conflict dialog** (Overwrite / Skip / Overwrite all / Skip all). Checking it needs a way to exercise screens automatically, which the project does not have yet. The rule behind it is covered: an import never overwrites silently.
- Reorganising the features' internals to make them easier to check, beyond the smallest changes needed.
- Other roadmap items: the tree filesystem decision, replacing the single hardcoded admin account with a role, and removing the Heroku leftovers.

---

## 4. Findings

Recorded while writing this spec (confirmed by reading the product's behaviour, 2026-10-09):

1. **Import does not check individual tracks.** A track with no name is accepted, and a track with no code is saved as an empty track. Whether that should be refused is a product decision. → follow-up roadmap item.
2. **A failed transition reports its error nowhere the user can see.** Volume is restored, but no message appears. Today's failures mostly come from broken pattern code, which the editor already reports on its own, so the impact is low. → follow-up roadmap item.

Found while writing the checks (each guarded by a check that is expected to fail until the follow-up lands):

3. **The EQ is audible while switched off.** When the page loads with the EQ saved as off and a shaped curve, the curve is applied anyway while the screen shows the EQ as off. Moving a slider or picking a preset while it is off does the same. **User-audible**, so this is the highest-priority follow-up.
4. **Cancelling the screen picker shows "Screen capture permission is required…"** The spec says cancelling should show nothing. Browsers report "cancel" and "deny" the same way, so this is a product decision: either keep one message, or word it to cover both.
5. **Some malformed imports get the wrong answer.** An empty-valued track or folder list, or an import that is not a list at all, either reports a generic error or claims success, instead of "invalid data". Nothing is saved in any of these cases, so the user's library is safe; only the message is wrong.
6. **An unused import route copies whatever fields it is sent onto the saved tracks.** It is not called by the app today, and the owner of each track is still forced to the signed-in user. Remove it or narrow it.

7. **Damaged EQ settings can break the EQ panel on load.** Settings with the right number of bands but unreadable values (empty bands, non-numeric gains) are accepted. The panel then fails to open, or passes an invalid gain to the audio engine, instead of starting flat. The same "audible while off" problem (finding 3) also happens when a whole saved EQ state is restored with the EQ off.

Follow-ups for 1–7 are on the roadmap under Phase 4.
