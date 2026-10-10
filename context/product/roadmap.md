# Product Roadmap: Strudel Client

_This roadmap outlines our strategic direction based on customer needs and business goals. It focuses on the "what" and "why," not the technical "how."_

Items marked shipped (`[x]`) are live on `strudel.dygy.app`. The specs numbered 001–014 were migrated from `.kiro/specs/` on 2026-10-08. Their `tasks.md` checkboxes were written in Kiro and may be stale, so trust the code over the ticks. [`feature-map.md`](./feature-map.md) has every feature's code and tests.

---

### Phase 1 — Cloud library (shipped)

- [x] **Sign in and per-user storage**
  - [x] **Google login through Supabase:** session restore, refresh and sign-out; RLS per user.
  - [x] **Import existing patterns:** ZIP and folder import with conflict resolution ([003](../spec/003-supabase-import-fix/)).
- [x] **Organise and navigate**
  - [x] **Track URLs:** bookmark or reload straight into `/repl/<folder>/<track>/<step>` ([001](../spec/001-track-routing-navigation/)).
  - [x] **Random track on open:** `/repl` lands on a random track from the library ([005](../spec/005-random-track-loading-fix/)).
  - [x] **File tree:** folders, multitracks with steps, drag and drop, export, strict autosave and emergency save.

### Phase 2 — Performance audio (shipped)

- [x] **Live-set tooling**
  - [x] **Headphone preview and mixer:** cue a change on a second engine before it reaches the speakers ([006](../spec/006-audio-mixer-preview/)).
  - [x] **Smooth transitions:** crossfade on update instead of a hard cut ([009](../spec/009-smooth-track-transitions/)).
  - [x] **10-band EQ:** presets and visualisation ([008](../spec/008-audio-equalizer/)).

### Phase 3 — Editor and output (shipped)

- [x] **Write faster**
  - [x] **Prettier for Strudel code** ([004](../spec/004-prettier-integration/), [011](../spec/011-prettier-strudel-dsl-formatting/)).
  - [x] **Context-aware autocomplete:** mini-notation, banks and samples ([010](../spec/010-enhanced-strudel-autocomplete/), [012](../spec/012-bank-autocomplete-mini-notation/)).
- [x] **Get music out**
  - [x] **Audio recording:** WAV and MP3 ([013](../spec/013-audio-recorder/)).
  - [x] **Screen and tab recording:** WebM ([014](../spec/014-screen-recorder/)).
  - [x] **Embed REPL for MIDI-grep** ([007](../spec/007-midi-grep-embed-integration/)).
- [x] **Reach more people:** 9 locales and RTL; Cloudflare Workers hosting; Weaver analytics.

---

### Phase 4 — Make it safe to change (next)

- [ ] **A test suite that can gate deploys**
  - [x] **Fix the routing tests:** `@src` alias added to the root vitest config; tests moved to the `/repl/<slug>` contract (2026-10-09, `da9ca9d`).
  - [x] **Fix the mixer and save-manager tests:** mixer Web Audio mock caught up with the EQ; save manager was the alias (2026-10-09).
  - [x] **Fix `xen`:** it was a `window` stub leaking between files under `isolate: false`; fixed with `unstubGlobals` (2026-10-09). `known-red-tests.txt` is empty.
  - [x] **Gate the deploy:** format, lint and tests all block the deploy (`needs: check`, 2026-10-09).
- [x] **Coverage for untested fork features:** smooth transitions, EQ, screen recorder, import, admin ([015](../spec/015-fork-feature-test-coverage/), 106 tests, 2026-10-09).
- [ ] **Fix what the coverage found** ([015 §4 Findings](../spec/015-fork-feature-test-coverage/functional-spec.md#4-findings)). Each one has a check waiting to go green:
  - [x] **EQ is audible while switched off** after a reload, when moved while off, or when a saved state is restored (fixed 2026-10-09).
  - [x] **Damaged EQ settings break the EQ panel** (empty bands or non-numeric gains pass the loader). They now fall back to flat (fixed 2026-10-09).
  - [ ] **Screen picker cancel message:** decide on the wording for cancel versus deny.
  - [x] **Malformed imports get the wrong answer.** All three import routes now refuse an unreadable or non-object body, or a non-list track or folder list, with 400 "Invalid data format" (fixed 2026-10-09).
  - [ ] **Import doesn't check individual tracks** (no name or no code): decide whether to refuse them. Related: a bad track item after the folders are saved leaves a **partial import** (the folders stay, then 500). Validate every item before saving anything.
  - [ ] **Failed smooth transition shows no message.**
  - [ ] **Unused tracks bulk-create route** copies whatever fields it's sent: remove it or narrow it.
- [x] **13 other API routes read the request body unguarded.** All now use `readJsonObject` (`website/src/lib/apiBody.ts`), so a bad body gets 400 "Invalid data format" (fixed 2026-10-10; `bodyGuard.test.ts`).
- [x] **`tree/*` routes answer 500 instead of 401 for an expired or missing session.** All tree routes now use the shared `api/_auth.ts`, which also reads the Bearer header, and map a typed `AuthError` to 401. The `tracks/*` routes no longer guess the status from message text. `tree/validate` no longer fails for every user (wrong `TreeManager` construction). Fixed 2026-10-10.
- [ ] **`packages/mondo` tests depend on their order** (they fail under `vitest --sequence.shuffle`).

### Phase 5 — Debt and decisions (later)

- [ ] **Tree filesystem: finish or remove.** The `tree_*` tables and `/api/tree/*` exist, but the API reverted to `tracks` ([002](../spec/002-scalable-tree-filesystem/)). No UI calls the tree API today. If it's finished, two things must change first:
  - `tree/{move,nodes,search,stats}` query with the anon key and never pass the user's token, so RLS sees no user: reads come back empty and writes fail.
  - `tree/validate` uses the service-role key outside `/api/admin/*`. It's isolated today only by an explicit `user_id` filter.
- [ ] **Admin identity:** replace the hardcoded admin email with a role.
- [ ] **Remove the Heroku leftovers:** `Dockerfile`, `server.js`.
