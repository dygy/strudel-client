# Functional Specification: Loudness Meter and Analyser

- **Roadmap Item:** Phase 6, Live sets: "Loudness meter and analyser: LUFS/RMS, spectrum before and after the EQ, clipping warning." There is no GitHub issue.
- **Status:** Draft
- **Author:** Claude (for the owner). The owner chose these on 2026-11-17:
  - **Placement:** a **compact loudness strip** in the header and in the performance view, plus a detailed **Settings → Meter** panel.
  - **What is measured:** the speakers output **after the EQ and before the speakers volume**. This is what Record as heard records, so the volume knob doesn't change the readings. Clipping is also detected **before the EQ limiter**, which shows that the limiter is working.
  - **Spectrum before the EQ:** a second, paler layer behind the EQ curve, next to the existing post-EQ spectrum (spec 026), with its own toggle.
  - **When Integrated resets:** on Play after Stop, and with a Reset button. Track switches inside a set don't reset it.

---

## 1. Overview and Rationale (The "Why")

The performer can already see peak levels: the performance view has two peak bars and a clip light (spec 030), and the EQ shows a live spectrum (spec 026). What they can't see is **how loud the music actually sounds**.

Peak level says little about that. A squashed track and an open one can peak at the same level and still sound 10 dB apart. Streaming services and broadcasters also judge loudness in LUFS, not peaks. So today:
- the performer can't tell whether the next track is louder than the last one;
- they can't tell whether a recorded set will be turned down by a streaming service;
- they can't tell whether the EQ limiter is quietly squashing the mix.

The spectrum shows only the result after the EQ, not what the EQ did to it.

**Desired outcome:**
- Loudness readings that follow the broadcast standard (EBU R128 / ITU-R BS.1770): Momentary, Short-term, Integrated and true peak.
- A clipping warning that says *why*.
- A before/after view of the EQ.
- All of it at a glance in the header and on stage, and in detail in Settings.

**Success looks like:**
- During a set the performer glances at the header, sees Short-term at −9 LUFS against a −14 target, and turns the next track down.
- After an hour, Integrated shows the loudness of the whole set.
- When the limiter starts working, a warning light tells them, and the panel says it was the limiter.
- Opening the EQ, they see the bass bump they added as the gap between the pale "before" spectrum and the bright "after" one.
- Nothing is ever heard from any of this.

---

## 2. Functional Requirements (The "What")

### 2.1 What is measured

- **The speakers (main) output, after the EQ** (its bands, cuts, output level and limiter, or the plain output while the EQ is off), **before the speakers volume** (spec 031).
  - This is the same signal Record as heard records (spec 026).
  - It includes the master FX (spec 032) and both tracks during a transition.
  - Moving the speakers volume doesn't change any reading.
- **The headphones (preview, Cue) are never measured.**
- **Before the EQ limiter:** the level going into the limiter is watched too. It is used only for the "limiter working" warning (§2.4).
- **Measuring is silent:** nothing about the sound changes when the meter is on or off, when it is shown or hidden, or when it resets.
- **Acceptance Criteria:**
  - [ ] Given a track playing, when the speakers volume moves from 100 % to 20 %, then Short-term changes by less than 0.1 LU.
  - [ ] Given only the headphone preview playing, then every reading shows silence.
  - [ ] Given the meter on, then the speakers output matches the output with the meter off (the difference stays below −90 dBFS).

### 2.2 Loudness readings

- **Momentary (M):** the loudness of the last 0.4 s.
- **Short-term (S):** the loudness of the last 3 s.
- **Integrated (I):** the loudness since the last reset.
  - **Gating** follows the standard: anything quieter than −70 LUFS is ignored, and so is anything more than 10 LU below the running level.
  - So silence and quiet breaks don't drag it down.
- **True peak (TP):** the highest true (inter-sample) peak since the last reset, in dBTP. It is estimated by 4× oversampling.
- **Units:** loudness is in LUFS, with one decimal. Silence shows "—", never −∞ or a huge negative number.
- **Update rate:** the readings update at least 10 times a second while music plays.
- **Accuracy:** loudness readings follow EBU R128 / ITU-R BS.1770-4, to within ±0.3 LU on the standard test signals.
- **Acceptance Criteria:**
  - [ ] Given a stereo 1 kHz sine at −23 dBFS for 20 s, then M, S and I each read −23.0 ± 0.3 LUFS.
  - [ ] Given 20 s of that sine followed by 20 s of silence, then I still reads −23.0 ± 0.3 LUFS (silence is gated out), while M and S show "—".
  - [ ] Given 20 s at −23 dBFS followed by 20 s at −43 dBFS, then I reads −23.0 ± 0.5 LUFS, because the quiet part is more than 10 LU below and is gated.
  - [ ] Given a sine at a quarter of the sample rate, phase-shifted by 45°, with a sample peak of −3.01 dBFS, then TP reads 0.0 ± 0.5 dBTP.

### 2.3 Reset

- Integrated, true peak, the warning counts and the history clear when either of these happens:
  - Play starts after Stop. Update while playing is not a Stop, so it doesn't reset.
  - The user clicks **Reset** in the panel.
- **A track switch inside a set doesn't reset anything.** This holds for the set playlist's Go, transitions and the manual crossfader. So Integrated covers the whole set.
- **After Stop:**
  - M and S show "—".
  - I, TP and the counts keep their last values, so the performer can read the result after the set, until the next Play.
- **Acceptance Criteria:**
  - [ ] Given 30 s played, then Stop, then I still shows its last value; Play then shows I as "—" until enough sound has been measured.
  - [ ] Given a set playing when Go switches to the next track, then I keeps accumulating and isn't cleared.
  - [ ] Given Reset while playing, then I, TP, the warning counts and the history clear, and measuring continues.
  - [ ] Given Update while playing, then I isn't cleared.

### 2.4 Clipping warning

- **One warning light**, shown in the header strip, in the performance strip and in the panel. It turns on when any of these happens:
  1. **Over the true-peak limit:** a true peak above **−1 dBTP**, the usual streaming headroom.
  2. **Limiter working:** while the EQ is on, the level going into its limiter reaches the limiter's ceiling (−0.3 dBFS, spec 020). The limiter is then turning the mix down.
  3. **Clipping:** a sample at or above 0 dBFS reaches the speakers. This can only happen while the EQ is off.
- **Latching:** the light stays on until the user clicks it (or the panel's Reset), even if the overload was a single moment.
- **The panel lists counts by reason.** It shows how many times each of the three happened since the last reset. An event that lasts counts once, not once per sample: a gap of at least 0.5 s separates events.
- **Hover/long-press text on the light** says which reasons it has seen. For example: "Limiter working (3×) — click to clear".
- The existing performance-view **clip light (spec 030) stays as it is**: it is the instant light, on for 2 s at −0.3 dBFS. The new warning sits next to it as the latching one.
- **Acceptance Criteria:**
  - [ ] Given the EQ on with output gain pushing the mix into the limiter, then the warning lights and the panel's "Limiter working" count rises by 1 per event.
  - [ ] Given the EQ off and a sample at 0 dBFS, then the warning lights with "Clipping".
  - [ ] Given a true peak of −0.5 dBTP with sample peaks below −1 dBFS, then the warning lights with "True peak over −1 dBTP".
  - [ ] Given a mix peaking at −3 dBTP, then the warning stays off.
  - [ ] Given the warning lit, when the user clicks it, then it turns off, and the counts stay until Reset.

### 2.5 Header and performance strip (compact)

- **Desktop header:** a small loudness strip showing:
  - the **Short-term** value as a number;
  - a thin bar with a mark at the chosen target (§2.6);
  - the latching warning light.
  - Clicking the number opens **Settings → Meter**.
- **Performance view (spec 030):** the same strip sits next to the existing peak bars. The peak bars and the 2 s clip light are unchanged. At 375 px wide the strip fits without horizontal scrolling and may wrap.
- **Compact (phone) layout:** the header strip isn't shown, because the bar has no room. The performance view and the panel still show everything.
- **Colour of the Short-term number:**
  - neutral within ±2 LU of the target;
  - amber when louder than target + 2 LU;
  - dimmed when quieter than target − 6 LU;
  - with the target off, always neutral.
- **Acceptance Criteria:**
  - [ ] Given a desktop window while music plays, then the header shows the Short-term value, and it matches the panel's S.
  - [ ] Given the performance view at 375 px, then the loudness strip and the existing peak bars are fully visible with no horizontal scroll.
  - [ ] Given a target of −14 and S at −10, then the number is amber; at −14.5 it is neutral.

### 2.6 Settings → Meter panel

The panel comes after Master FX and contains:
- **Readings:** M, S, I (large), TP (max since reset), and **loudness range (LRA)**.
  - LRA is the standard spread of Short-term loudness over the measured time. It shows "—" until 10 s have been measured.
- **Peak and RMS bars:** left and right, each with its current peak and 300 ms RMS in dBFS.
- **History:** a graph of the last 60 s.
  - It plots Short-term as a line and Momentary as a fainter line.
  - It also shows the target line and marks where a warning happened.
  - It scrolls while playing and freezes on Stop.
- **Target:** a choice of **−14 LUFS (streaming)**, **−23 LUFS (broadcast, EBU R128)**, **−9 LUFS (club)** or **Off**. The default is −14. It is remembered in this browser.
- **Warning counts** by reason (§2.4) and the warning light.
- **Reset** button (§2.3).
- **Loudness meter on/off** switch, on by default and remembered in this browser.
  - Off removes the header strip, the performance-view loudness strip and the panel readings.
  - The spec 030 peak bars stay, because they are their own feature.
- **Acceptance Criteria:**
  - [ ] Given 60 s of play, then the history shows 60 s of S and M; after Stop it stops scrolling.
  - [ ] Given the target set to −23 and a reload, then the target is still −23.
  - [ ] Given the meter switched off, then no loudness strip shows in the header or the performance view, and the meter adds no work while music plays.
  - [ ] Given a stereo 1 kHz sine at −20 dBFS, then both RMS bars read −23 ± 0.5 dBFS and both peak bars read −20 ± 0.5 dBFS.

### 2.7 Spectrum before the EQ

- Behind the EQ curve, next to the existing spectrum (spec 026, after the EQ), there is a second spectrum layer: **before the EQ**.
  - It is the main output as it enters the EQ.
  - It is drawn in a paler, different tint, so the gap between the two layers shows what the EQ does.
- A **"Before EQ"** toggle sits next to the existing Spectrum toggle. It is off by default and remembered in this browser.
- It is drawn only while the Spectrum toggle and the Before EQ toggle are both on and the speakers play. It stops drawing when stopped or hidden, just like the 026 spectrum.
- **Acceptance Criteria:**
  - [ ] Given the EQ with +12 dB at 100 Hz and noise playing, with both layers on, then at 100 Hz the after-EQ layer is about 12 dB above the before-EQ layer (±3 dB), and at 2 kHz they match within ±2 dB.
  - [ ] Given the EQ off, then the two layers match within ±1 dB across 50 Hz–15 kHz.
  - [ ] Given Before EQ off, then only the 026 spectrum is drawn and no before-EQ measurement runs.

### 2.8 Strudel-specific behaviour

- **Unsaved work:** untouched. The meter never changes a track's code, the editor or any save path.
- **What is heard:** nothing. The meter only listens, and turning it on or off, resetting it or showing it never clicks or changes the output (§2.1).
- **Logged out:** everything works. Nothing is stored on the server.
- **Admin read-only view:** the meter reads what the admin plays, as for any listener. Nothing is saved.
- **Locales:** every new string is added to all 9 locales. RTL locales mirror the panel layout, but numbers and the history graph's time axis stay left-to-right (old on the left, now on the right).
- **Storage:** the target, the meter on/off and the Before EQ toggle are kept in this browser. There is no schema change and no new secret.
- **Performance:** measuring adds no noticeable load to the audio. Drawing happens only for what is visible, and not while the tab is hidden.

---

## 3. Scope and Boundaries

### In-Scope

- Momentary, Short-term and Integrated LUFS, true peak, LRA, and peak/RMS per channel on the speakers output after the EQ.
- The latching clipping warning with three reasons, and counts.
- The compact strip in the desktop header and the performance view.
- The Settings → Meter panel: readings, bars, 60 s history, target, Reset and on/off.
- The before-EQ spectrum layer behind the EQ curve.
- Resets on Play after Stop and with Reset.

### Out-of-Scope

- Metering the headphones (preview).
- Saving loudness with a track, or loudness-based automatic gain. Match loudness for transitions stays spec 017's own measurement.
- Exporting a loudness report or attaching it to recordings.
- Per-track or per-orbit meters.
- Changing the spec 030 peak bars or their clip light.
- A MIDI mapping for Reset or for clearing the warning. It can be added to the 031 map later.

---

## Affected areas

- **Audio:** the measurement on the speakers output and before the EQ limiter, and the before-EQ spectrum tap. Owner: strudel-audio-engineer.
- **Web:**
  - the header strip, the performance-view strip and the Settings → Meter panel;
  - the Before EQ toggle in the EQ panel;
  - the reset on Play after Stop;
  - strings in all 9 locales.

  Owner: strudel-web-engineer.
- **Tests:** strudel-test-engineer.

---

## Change Log

- (none yet)
