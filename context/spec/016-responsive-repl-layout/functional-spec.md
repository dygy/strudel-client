# Functional Specification: Responsive REPL Layout for Phones, Tablets and Landscape

- **Roadmap Item:** Not on the roadmap. Requested by the owner in chat on 2026-10-29: on a phone the settings could not be closed and covered all the code, and they want "an adaptive layout at last". No GitHub issue.
- **Status:** Completed — live since 4148d63 (2026-10-30). Checks on a real device (on-screen keyboard, native long press and drag) are owner checks; see flow-log.
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

The REPL is built for a laptop: the code editor in the middle, the track library on one side and the settings panel on the other. On a phone or a tablet held upright, those side areas leave almost no room for code. With the library open on a phone, about a finger's width of the editor stays visible, and the main buttons (play, update, stop) sit in a crowded header.

The owner performs and sketches tracks away from the laptop too. They want to open the app on a phone or tablet, pick a track, play it, edit it, switch to the next track with the usual smooth crossfade, and adjust the mixer and EQ, all with touch.

The first step has already shipped: on small screens, the settings panel opens as a full-screen sheet with a close button that is always reachable. This specification covers the rest of the screen.

**Success looks like:**
- On a phone (portrait or landscape) and on a tablet held upright, the code editor uses the full width whenever no library or settings sheet is open.
- Every action the owner uses during a set (play, update, stop, open the library, open settings, switch track) can be done with one thumb, with tap targets at least 44 × 44 points.
- The laptop and desktop layout looks and works exactly as it does today.

**Screen classes used in this document:**
- **Compact screen:** a phone in portrait or landscape, or a tablet held upright. This is the same rule the settings sheet already uses: narrower than 768 points; or shorter than 500 points and narrower than 1024; or taller than it is wide and narrower than 1024.
- **Wide screen:** everything else, including a tablet held sideways at 1024 points or wider and every laptop or desktop. A wide screen keeps today's layout.

---

## 2. Functional Requirements (The "What")

### 2.1 Playing and editing code on a compact screen

- **As a** performer on a phone, **I want** the code to fill the screen and the main controls under my thumb, **so that** I can play and edit without zooming or hunting for buttons.
  - A **control bar along the bottom edge** of the screen holds Play/Stop, Update, Library and Settings, each at least 44 × 44 points, in thumb reach. The top keeps only a thin title bar with the track's name and a "More" menu. The less frequent actions (record, share and the other header items) move into "More".
  - While the on-screen keyboard is open, the control bar sits directly above the keyboard, and the line being edited stays visible above the bar.
  - Pinch-zooming the page is not needed to read or edit the code; the code text is at least as large as it is on the desktop.
  - **Acceptance Criteria:**
    - [ ] Given a compact screen with the library and settings closed, when the REPL opens on a track, then the code editor spans the full width of the screen with no side panel beside it.
    - [ ] Given a 390 × 844 phone, when the user looks at the screen, then Play/Stop, Update, Library and Settings are in a bar along the bottom edge, visible without scrolling, and each tap area is at least 44 × 44 points.
    - [ ] Given a phone with the on-screen keyboard open, when the user looks at the screen, then the control bar sits directly above the keyboard and its buttons still work.
    - [ ] Given a compact screen, when the user opens the "More" menu, then record, share and the other header actions are listed there, and when the user taps one, then it does the same thing as on the desktop.
    - [ ] Given a phone with the on-screen keyboard open, when the user types on a line in the lower half of the code, then that line stays visible above the keyboard.
    - [ ] Given a compact screen, when the user taps Play, Update or Stop, then the music starts, updates or stops exactly as with the desktop buttons and shortcuts.

### 2.2 The track library as a drawer on a compact screen

- **As a** performer on a phone, **I want** the library to slide over the code when I need it and get out of the way when I don't, **so that** browsing tracks never squeezes the editor.
  - On a compact screen the library opens as a drawer that covers the code, from the side where the library sits on the desktop (the left, or the right in Hebrew and Arabic). It is closed when the REPL first opens on a compact screen, even if it was left open on a desktop.
  - The drawer can be closed with a close button, by tapping outside it, or with a swipe back towards its edge.
  - Everything the library does on the desktop works in the drawer: open a track, open a folder, rename, delete, create a track or folder, multitrack steps.
  - Picking a track in the drawer loads it into the editor (it does not start playing by itself, the same as on the desktop) and **closes the drawer**, so the code is visible right away. The next Update then crossfades to it as usual. Opening or closing a folder, or a step of a multitrack, keeps the drawer open.
  - Actions that need a right-click on the desktop (rename, delete, and so on) are reachable on touch with a long press or a "⋮" button on each row.
  - The library drawer and the settings sheet are never open at the same time on a compact screen: opening one closes the other. This is already how the settings sheet behaves.
  - **Acceptance Criteria:**
    - [ ] Given a compact screen and a library left open on the desktop, when the REPL opens, then the library is closed and the code fills the screen.
    - [ ] Given a compact screen, when the user taps Library, then the drawer slides over the code, and when the user taps outside it or its close button, then it closes and the code is fully visible again.
    - [ ] Given the drawer is open, when the user taps a track, then the drawer closes, that track's code appears in the editor and its address appears in the browser bar.
    - [ ] Given the drawer is open, when the user taps a folder, then the folder opens or closes and the drawer stays open.
    - [ ] Given the drawer is open on a touch screen, when the user long-presses a track or taps its "⋮" button, then the same actions as the desktop right-click menu appear (rename, duplicate, delete, info, download).
    - [ ] Given the settings sheet is open, when the user taps Library, then the settings sheet closes and the drawer opens.
    - [ ] Given the Hebrew or Arabic interface, when the user opens the drawer, then it slides in from the right edge.

### 2.3 Mixer, EQ and headphone preview on touch

- **As a** performer on a phone or tablet, **I want** to use the mixer, the EQ and headphone preview with my fingers, **so that** I can cue and shape the sound without a mouse.
  - In the settings sheet, every mixer and EQ control (sliders, knobs, toggles, preset choices, the preview button, the output device choice) is at least 44 points tall or wide where the user touches it.
  - Sliders can be dragged with a finger without scrolling the sheet by accident, and their current value is shown while dragging.
  - On a compact screen the EQ shows the **whole curve on top, fitting the screen width, and the controls of one selected band below it**. Tapping a point on the curve (or a band number) selects that band; the band's frequency is shown, and its gain is adjusted with a large slider (the same control the desktop has for each band). The EQ on/off switch and presets stay available.
  - **Acceptance Criteria:**
    - [ ] Given a 390 × 844 phone with the settings sheet on the mixer tab, when the user inspects any control, then its touch area is at least 44 points in its smallest direction.
    - [ ] Given the mixer on a phone, when the user drags a volume slider with a finger, then the value changes and is shown while dragging, and the sheet itself does not scroll.
    - [ ] Given the EQ on a phone, when the user opens it, then the whole curve is visible without sideways scrolling, with the controls of one band below it.
    - [ ] Given the EQ on a phone, when the user taps a point on the curve, then that band becomes selected with its frequency shown and its gain slider below, and when the user changes the gain, then the sound and the curve change exactly as with the desktop control.
    - [ ] Given music is playing, when the user starts and stops headphone preview from the sheet, then preview behaves exactly as on the desktop.

### 2.4 Tablets and landscape

- **As a** performer on a tablet or a phone held sideways, **I want** a layout that suits the shape of the screen, **so that** neither orientation wastes space or hides the code.
  - A tablet held upright (narrower than 1024 points) uses the compact layout from 2.1–2.3.
  - A tablet held sideways at 1024 points or wider uses the desktop layout unchanged.
  - A phone held sideways uses the compact layout. The title bar and the bottom control bar together take no more than 25% of the screen height, not counting the strips the phone reserves for its notch or home indicator (controls never sit in those strips), so the code keeps most of the screen.
  - Rotating the device switches between layouts immediately, without reloading the page.
  - **Acceptance Criteria:**
    - [ ] Given an 820 × 1180 tablet held upright, when the REPL opens, then it shows the compact layout with the code at full width.
    - [ ] Given a 1180 × 820 tablet held sideways, when the REPL opens, then it shows the same layout as a laptop.
    - [ ] Given an 844 × 390 phone held sideways, when the REPL opens, then the title bar and the control bar together take no more than 25% of the screen height (about 97 points, not counting the phone's notch or home-indicator strip) and the code fills the rest.
    - [ ] Given music is playing on a tablet, when the user rotates it, then the layout changes without a reload and the music keeps playing without a gap or click.

### 2.5 Things that must not change

- **Unsaved work:** opening or closing the drawer, the settings sheet or the "More" menu, rotating the device, or changing between layouts never loses an edit. Switching to another track from the drawer keeps today's behaviour, where the current edit is saved first.
  - **Acceptance Criteria:**
    - [ ] Given an unsaved edit in the editor, when the user opens and closes the drawer and rotates the device, then the edit is still in the editor, and when autosave runs, then it is saved to the same track.
    - [ ] Given an unsaved edit, when the user picks another track in the drawer, then the edit is saved to the original track before the new track appears.
- **Sound:** nothing in this layout work makes a sound start, stop, jump in volume, or restart. Opening or closing a drawer or sheet, the "More" menu, or rotating the device never interrupts playback.
  - **Acceptance Criteria:**
    - [ ] Given music is playing, when the user opens and closes the drawer, the settings sheet and the "More" menu, then playback continues with no gap, click or change in volume.
- **Desktop:** on a wide screen everything looks and works as before this change.
  - **Acceptance Criteria:**
    - [ ] Given a 1440 × 900 laptop screen, when the REPL opens, then the header, library, editor and settings panel look and behave the same as before this change (compared with screenshots taken before it).
- **Signed out:** the sign-in page and the "sign in to see your library" prompt are usable on a phone.
  - **Acceptance Criteria:**
    - [ ] Given a signed-out user on a 390 × 844 phone, when they open the sign-in page, then the Google sign-in button is fully visible and at least 44 points tall, and the page has no sideways scrolling.
- **Admin read-only view:** an administrator viewing another user's tracks gets the same compact layout, with no rename, delete or edit actions offered.
  - **Acceptance Criteria:**
    - [ ] Given the admin read-only view on a phone, when the admin opens the drawer and long-presses a track, then no rename, delete or create actions are offered.
- **Languages:** every new label (for example "More", "Library", "Close library") is available in all 9 languages (English, Spanish, French, Russian, Serbian, Hebrew, Arabic, Chinese, Korean), and in Hebrew and Arabic the layout is mirrored.
  - **Acceptance Criteria:**
    - [ ] Given the interface in any of the 9 languages, when the user opens the compact layout, then every new label appears in that language and none falls back to English.
    - [ ] Given the Hebrew or Arabic interface on a phone, when the user looks at the header and the drawer, then their order and the drawer's side are mirrored.

---

## 3. Scope and Boundaries

### In-Scope

- The compact layout for phones (portrait and landscape) and tablets held upright: a thin title bar with the "More" menu, a bottom control bar with the main controls, the editor at full width, and the code staying visible above the on-screen keyboard.
- The library as a drawer on compact screens, with touch access to every library action.
- Touch-sized mixer, EQ, preview and output-device controls inside the existing settings sheet.
- Tablet held sideways and every wide screen keep the desktop layout.
- The sign-in page and the signed-out prompt on phones.
- New labels in all 9 languages, and mirroring for Hebrew and Arabic.

### Out-of-Scope

- A native mobile app (a product non-goal).
- Changing the desktop layout in any way.
- New features that don't exist on the desktop (for example gestures that do something the desktop can't, or a separate "performance mode").
- Changes to how sound is produced, mixed or crossfaded: this work is visual and touch-only.
- The docs, workshop and blog pages outside the REPL.
- The `/embed` REPL used for automation.
- Other roadmap items: the deploy-gating test suite, the coverage findings in spec 015, the locale quality issues, the tree filesystem decision, the admin role, and removing the Heroku leftovers.

---

## Change Log

_Dated amendments made after the spec was first written — typically by `/awos:spec` in Update Mode when a bug fix changed documented behavior. Each entry records the date, the source reference (bug id or fix description), and what behavior changed and why. Leave empty until the first amendment._
- 2026-10-30 — implementation of §2.3 — the phone EQ adjusts only the selected band's gain and shows its frequency. Frequency and width sliders were dropped: band centres are fixed and the desktop has no width control, so they would be phone-only features (out of scope, §3).
- 2026-10-30 — review finding 5 (safe areas) — the 25% landscape limit excludes the system notch and home-indicator strips; controls are kept out of them (on an iPhone with a home indicator the bars measure about 113 points including that strip).
