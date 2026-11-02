# Functional Specification: Strudel for AI Assistants (MCP Server)

- **Roadmap Item:** Not on the roadmap. Requested by the owner in chat on 2026-11-02. No GitHub issue.
- **Status:** Draft
- **Author:** Claude (for the owner, Dygy)

---

## 1. Overview and Rationale (The "Why")

Today an AI assistant can only help with Strudel if the user copies code back and forth. The assistant can't see the library, doesn't reliably know which functions and samples exist, can't tell whether its code works, and can't play anything. It often invents functions, and the user finds out when the track fails.

This feature connects AI assistants (Claude and any other assistant that supports the MCP standard) to Strudel. After connecting once, the user can say "find my techno tracks, write a variation of the darkest one, save it next to it and play it", and the assistant can do all of it with the user's own account.

**Success looks like:**
- A user connects an assistant in under a minute, using only their Google sign-in, with nothing to install.
- An assistant writes a track that runs on the first try, because it can look up real functions and check its code before saving.
- No assistant action ever silently overwrites the user's work.
- An assistant never makes a sound unless the user has allowed that in that browser tab.

**Words used in this document:**
- **Assistant:** the AI application the user connects to Strudel.
- **Library:** the user's folders, tracks and the steps of their multitracks.
- **Open tab:** a browser tab with the Strudel editor, where the user is signed in.
- **Pattern check:** finding mistakes in code without running it.
- **Pattern run:** working out which notes and sounds a pattern produces, without playing audio.
- **Local helper:** a small optional program the user installs on their own computer to get pattern runs.
- **Cycle:** the musical unit Strudel counts time in.

---

## 2. Functional Requirements (The "What")

### 2.1 Connecting an assistant

Any user who signs in with Google can connect an assistant, and it only ever reaches that user's own library. The user adds one address, `https://strudel.dygy.app/mcp`, to the assistant.

The first time, a browser page opens. If the user is signed out, they sign in first. They then see a consent page that names the assistant and lists what it will be able to do, including permanently deleting tracks and folders, and has **Allow** and **Deny** buttons.

- [ ] When a signed-out user adds the address to an assistant, then the browser asks them to sign in with Google and afterwards shows the consent page.
- [ ] When the user presses **Allow**, then the assistant reports that it is connected and can reach their library.
- [ ] When the user presses **Deny**, then the assistant reports that access was refused and it can't reach anything.
- [ ] Given no sign-in has happened, when an assistant tries any action at the address, then it is told to sign in and receives no data.
- [ ] When two different users connect the same assistant application, then each one sees only their own library.

### 2.2 Seeing and ending connections

The user can see which assistants are connected to their account and disconnect any of them, in a **Connected assistants** section of the settings panel. It works in the desktop and the phone layouts.

- [ ] When the user opens **Connected assistants**, then they see each connected assistant's name and when it was connected.
- [ ] When the user presses **Disconnect** on an assistant, then within 1 minute its next action is refused and it has to ask for consent again.
- [ ] When no assistant is connected, then the section says so and links to the setup instructions.

### 2.3 Browsing and reading the library

An assistant can list folders, search tracks by name, folder or text in the code, and read a track, including every step of a multitrack. Long lists come back in pages. Each track comes with its web address, so the assistant can give the user a link that opens it.

- [ ] When an assistant searches for a word that is in a track's name or code, then that track is in the results with its folder and its web address.
- [ ] When an assistant reads a multitrack, then it receives every step's name and code in the order the user sees them.
- [ ] When an assistant asks for a track that doesn't exist or belongs to someone else, then it is told "Track not found" and can't tell which of the two is true.
- [ ] When a user's library has more tracks than fit in one answer, then the assistant can ask for the next page until it has seen all of them, each exactly once.

### 2.4 Changing the library

An assistant can create tracks and folders, change a track's code, add, change and reorder multitrack steps, rename, and move. The same naming rules as in the app apply. A track created or changed this way appears in the library after a reload, exactly as if it had been made in the app.

To change a track, the assistant must say which version it read. If the track has changed since then (for example, the user kept typing), nothing is written. The assistant is told the track changed and has to read it again.

- [ ] When an assistant creates a track in a folder, then after a reload it appears in that folder in the sidebar and its web address opens it.
- [ ] Given a track was edited after the assistant read it, when the assistant tries to save its change, then nothing is saved and the assistant is told "This track changed since you read it".
- [ ] When an assistant gives a track a name already used in that folder, then nothing changes and it is told the name is taken.
- [ ] When an assistant sends code larger than the 512 KB limit, then nothing is saved and it is told the limit.
- [ ] When an assistant sends a change with several fields and one of them is invalid, then nothing at all is saved.

### 2.5 An open tab must never overwrite an assistant's change, or the reverse

If an assistant saves a new version of a track that is open in a browser tab, the tab's copy is out of date. The tab must not save its old copy over the new one.

As soon as the tab notices, autosave for that track pauses and the tab shows a message: **"This track was changed elsewhere"**, with **Load the new version** and **Keep mine** buttons. **Keep mine** saves the tab's text as a new version. Nothing the user typed is thrown away without them choosing that. Music keeps playing throughout, whichever button they press and for as long as they take to decide.

The same protection covers the same track open in two tabs.

- [ ] Given a track is open in a tab, when an assistant saves a new version of it, then within 30 seconds the tab shows the message and stops autosaving that track.
- [ ] Given the message is showing, when the user presses **Load the new version**, then the editor shows the assistant's code and the music continues unchanged until the user presses Update.
- [ ] Given the message is showing, when the user presses **Keep mine**, then the tab's text is saved and is what the next reader gets.
- [ ] Given the message is showing and the user has typed since the last save, when they reload the page, then the text they typed is still offered to them and hasn't been lost.
- [ ] When no assistant is involved, then normal typing and autosave behave as they do today, with no new message.

### 2.6 Deleting

An assistant can permanently delete one track, one multitrack step, or one empty folder. There is no trash, so a deleted track can't be restored. The assistant application is told that these actions are destructive, so it can ask the user first.

There is no "delete everything" action, and no deleting a folder that still contains anything.

- [ ] When an assistant deletes a track using the version it read, then the track disappears from the library after a reload.
- [ ] Given a track changed after the assistant read it, when the assistant tries to delete it, then it isn't deleted and the assistant is told it changed.
- [ ] When an assistant tries to delete a folder that contains anything, then nothing is deleted and it is told what's inside.
- [ ] Given a track is open in a tab, when an assistant deletes it, then the tab shows the same "changed elsewhere" message, and **Keep mine** saves the tab's text as a track again.

### 2.7 Looking things up and checking code

An assistant can look up Strudel's functions, with their descriptions, parameters and examples, and list the available sample banks and sounds. The answers match the version running on the site.

A **pattern check** reports mistakes in code and in mini-notation with the line and column, and warns about function names that don't exist, with the closest real name. Code is never run by a check.

The online service checks code up to 8 KB. Larger code needs the local helper (§2.9), because the online service runs on a plan with a strict limit on work per request.

- [ ] When an assistant looks up a function that exists, then it gets the description, parameters and at least the examples shown in the site's reference.
- [ ] When an assistant asks about a function that doesn't exist, then it is told so and offered the closest real names.
- [ ] When code contains a syntax mistake, then the check reports the line and column of it.
- [ ] When a mini-notation string has unbalanced brackets, then the check reports that string's line and column.
- [ ] When code calls a misspelled function such as `.lowpas(`, then the check warns about it and suggests `.lowpass`.
- [ ] When an assistant asks the online service to check code larger than 8 KB, then it is told to use the local helper, and how to install it.

### 2.8 Controlling an open tab

Control is **off by default in every tab**. The user turns it on with an **Allow assistant control** switch in that tab, in the settings panel and in the phone layout's menu. While it's on, the tab shows a visible indicator with a one-press way to turn it off. Turning it on also counts as the click browsers require before a page may make sound. It turns off when the tab is reloaded or closed, or when the user signs out.

While it's on, an assistant can see which tabs allow control and what each is doing (track, playing or stopped, tempo), and can play, stop, update the running code, and open another track. Each assistant action shows a short message in the tab saying what happened.

**What the user hears:**
- **Update on the track that's playing:** the code changes in place, with no gap, fade or restart, the same as the user pressing Update.
- **Opening a different track while playing, then playing it:** the transition selected in the tab is used, the same as a user's switch.
- **Stop:** the same as the user pressing Stop.
- **Code with a mistake:** the current music keeps playing, the assistant receives the error, and the tab shows it as it would for the user.

**What happens to unsaved work:**
- Anything the user typed is saved before an assistant's code replaces it. If that save fails, the assistant's action is refused and the editor isn't touched.
- The assistant's code enters the editor like typing does: Undo brings the previous text back, and autosave saves it as usual.
- If the "changed elsewhere" message is showing, assistant actions on that tab are refused until the user chooses.

- [ ] Given no tab allows control, when an assistant asks to play, then it is told to ask the user to switch on **Allow assistant control**, and no sound is made.
- [ ] Given a playing tab allows control, when an assistant updates the code of that track, then the audio level has no drop or jump and the new code is heard.
- [ ] Given a playing tab allows control, when an assistant opens another track and plays it, then the transition selected in the tab is the one used.
- [ ] Given a playing tab allows control, when an assistant sends code with a mistake, then the music continues and the assistant receives the error with its line.
- [ ] Given the user has unsaved typing, when an assistant updates the code, then the typed text is saved first and Undo in the editor brings it back.
- [ ] Given a transition is in progress, when an assistant sends another play or update, then it is refused with "A transition is in progress" and the transition finishes undisturbed.
- [ ] Given two tabs allow control, when an assistant acts without naming one, then nothing happens and it is told to choose, with both listed.
- [ ] When the user turns off the switch or reloads the tab, then the next assistant action on that tab is refused within 5 seconds.
- [ ] When a tab of another user allows control, then an assistant connected to this user can't see or reach it.

### 2.9 Running patterns on the user's computer (local helper)

The online service can check small pieces of code but can't run them. Users who want an assistant to verify what a pattern actually produces, or to check large tracks, install the local helper, a one-line setup with no account needed. It works without a connection to the user's library.

A **pattern run** takes code and a number of cycles and returns the notes and sounds with their timing, plus a summary: which sounds are used, how many events there are per cycle, and the note range. No audio is produced. The default is 4 cycles, the most is 64, and answers stop at 2,000 events and say that they were cut off. A run taking over 10 seconds is stopped.

Code being run can't read the user's files, reach the network, or start other programs.

- [ ] When an assistant runs `s("bd sd")` for 2 cycles, then it receives 4 events with their start and end times, and a summary listing `bd` and `sd`.
- [ ] When code has a mistake, then the run returns the error with its line and nothing else stops working.
- [ ] When code never finishes, then the run stops within 10 seconds and says so, and the next run still works.
- [ ] When code tries to read a file or reach the network, then that attempt fails and the file's contents never appear in the answer.
- [ ] When a pattern produces more than 2,000 events, then the answer contains the first 2,000 and says it was cut off.
- [ ] When the assistant uses the local helper for a pattern that also runs in the browser, then the notes and sounds match what the browser's engine schedules for the same cycles.

### 2.10 Limits and failures

- [ ] When an assistant makes more than 120 requests in a minute, then further ones are refused with a message saying when to retry, and the app stays usable for the user.
- [ ] When the user's connection has expired, then the assistant is asked to reconnect and no data is lost.
- [ ] When the storage service is unreachable, then the assistant is told the action failed and may be retried, and nothing is half-saved.
- [ ] When an assistant does anything at all, then pages other than the affected track behave and load as they did before.

### 2.11 Setup instructions

A documentation page explains how to connect the common assistants, how to install the local helper, what each capability does, and how to disconnect.

- [ ] When a signed-out visitor opens the page, then they can read all of it without signing in.
- [ ] When a user follows the page's steps for Claude, then the assistant connects.

### 2.12 Behaviour in other parts of the product

- **Signed out:** no library or tab access of any kind. The local helper still works, as it doesn't use an account.
- **Admin:** the admin dashboard stays read-only and unchanged. Being an admin gives an assistant no access to other users' tracks.
- **Embed page:** it has no assistant control and no sign-in, as today.
- **Languages:** the consent page, the **Connected assistants** section, the **Allow assistant control** switch and indicator, the "changed elsewhere" message, and the short messages shown in the tab appear in all 9 languages. What the assistant itself receives, and the setup page, are in English, like the site's documentation.

- [ ] When the app is set to any of the 9 languages, then all new text the user sees on the consent page and in the tab is in that language, and right-to-left languages lay out correctly.
- [ ] When an admin connects an assistant, then it can reach only the admin's own library.

---

## 3. Scope and Boundaries

### In-Scope

- Connecting with Google sign-in and consent; listing and ending connections.
- Reading, searching, creating, changing, moving and deleting library items.
- Protection between assistants and open tabs, both ways.
- Function and sample lookup, pattern checks online up to 8 KB, and larger checks in the local helper.
- Control of an open tab that has allowed it: status, play, stop, update, open track.
- The local helper with pattern runs and summaries.
- Rate limits, setup documentation, 9 languages for what users see.

### Out-of-Scope

- Formatting code through an assistant. Dropped by the owner on 2026-11-02 rather than pay for the Cloudflare plan it needs online. The format command in the editor is unchanged.
- Rendering audio, or letting an assistant listen to the result.
- Control of the mixer, EQ, headphone preview, recording or audio devices.
- Choosing the transition type through an assistant: the tab's selection applies.
- Import and export of ZIP files through an assistant.
- Bulk deletion, a trash or version history.
- Sharing tracks between users or acting on another user's library.
- Control through the desktop app, or through the embed page.
- A list of every action an assistant has taken (an audit log).

---

## Change Log

- [YYYY-MM-DD] — [source reference] — [what behavior changed and why]
