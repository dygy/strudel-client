# Product Definition: Strudel Client (strudel.dygy.app)

- **Version:** 1.0
- **Status:** Active — migrated from `.kiro/steering/product.md` on 2026-10-08

---

## 1. The Big Picture (The "Why")

### 1.1. Project Vision & Purpose

Strudel Client is a fork of [Strudel](https://strudel.cc), the browser live-coding environment for algorithmic music (a JavaScript port of TidalCycles). Upstream Strudel is a single-pattern scratchpad. This fork turns it into a **personal music workspace**: your tracks live in the cloud behind a login, organised in folders and multi-step tracks, mixed and EQ'd like a DAW, previewed on headphones before they hit the speakers, and recorded to audio or video. All of it still runs in the browser.

### 1.2. Target Audience

- **Live coders and performers** who play sets from a library of their own tracks and need to switch between them on stage, smoothly and without losing audio.
- **Algorithmic composers** who build up a body of work over months and need it saved, organised and portable (import/export).
- **Tool builders** who drive Strudel from code, for example MIDI-grep through the `/embed` REPL.

### 1.3. User Personas

- **Persona 1: "Dygy the performer"**
  - **Role:** Owner and main user. Live-codes sets from a personal library.
  - **Goal:** Open the app, pick a track, cue the next one on headphones, crossfade it in, and record the set.
  - **Frustration:** Upstream Strudel forgets everything on reload, has no library, and cuts audio hard on every update.
- **Persona 2: "The visiting coder"**
  - **Role:** Anyone who signs in with Google.
  - **Goal:** Keep their own patterns, import a folder or ZIP of existing `.js` patterns, and use the REPL in their own language.
  - **Frustration:** Losing work, and English-only UI (9 locales are supported, including RTL).

### 1.4. Success Metrics

- No lost work: autosave and emergency save mean a reload or crash never drops code.
- Track switches during a live set are inaudible as glitches, thanks to the crossfade and preview engine.
- Every push to `main` deploys without a red run, and the test suite has no new failures against `context/product/known-red-tests.txt`.
- Visits, sources and conversions are tracked by Weaver (the tracker lives in `HeadCommon.astro`).

---

## 2. The Product Experience (The "What")

### 2.1. Core Features

The full inventory, with code paths, specs and tests for each feature, is in [`feature-map.md`](./feature-map.md). In summary:

- **Live-coding REPL**: the upstream pattern engine, mini-notation, synthesis and samples, CodeMirror editor, visuals and docs.
- **Cloud library**: Google sign-in through Supabase, plus a per-user file tree. The tree holds folders, tracks and multitracks (tracks made of steps). It supports drag and drop, ZIP/folder import with conflict resolution, export, strict autosave and emergency save.
- **Track routing**: every track has a URL (`/repl/<folder>/<track>/<step>`), so you can bookmark it and reload into it.
- **Performance audio**: a mixer with headphone preview on a second engine, output device selection, smooth crossfade transitions on update, and a 10-band parametric EQ.
- **Editor power-ups**: autocomplete that understands mini-notation, banks and samples; Prettier formatting for Strudel code; toggle and radio widgets; keyboard shortcuts.
- **Recording**: audio to WAV or MP3, and screen or tab to WebM.
- **Embed**: an `/embed` REPL with no auth, for automation such as MIDI-grep.
- **Admin**: a read-only view of every user's tracks.
- **i18n**: 9 locales, with RTL support.
- **Desktop**: the Tauri app, inherited from upstream.

### 2.2. User Journey

The user opens `strudel.dygy.app`. They sign in with Google and land in the REPL on a random track from their library. They browse the sidebar tree and click a track, which loads it and updates the URL. They edit the code and preview the change on headphones; Ctrl+U then crossfades it onto the speakers. Autosave keeps the code in Supabase. To share a set, they record audio or video and export it.

---

## 3. Project Boundaries

### 3.1. What's In-Scope

- Everything listed in `feature-map.md`, deployed as a Cloudflare Worker at `strudel.dygy.app`.
- Per-user data in Supabase, isolated by RLS.
- Keeping the upstream packages working and mergeable.

### 3.2. What's Out-of-Scope

- Shared or collaborative editing, and public track sharing (other than the admin view).
- Upstreaming fork features to codeberg.org/uzu/strudel. That is possible later, but not a goal.
- A native mobile app.
- Heroku hosting. `Dockerfile` and `server.js` are leftovers.

### 3.3. License

AGPL-3.0-or-later, inherited from upstream. Every derivative must stay open source under the same license.
