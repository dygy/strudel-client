# Flow log — 019 vinyl scratch control

## 2026-11-12 — Steps 1–4: gather, workspace, spec/tech/tasks

- **Source:** owner chat request (no issue). Option A chosen (audio-buffer scratch, not pattern jog).
- **Workspace:** git worktree `.claude/worktrees/019-scratch` (branch `worktree-019-scratch`), because a parallel session (`strudel-client-4a`) is running /fix on spec 008 EQ in the main checkout, and its untracked `context/spec/008-audio-equalizer/flow-log.md` is there.
- **Coordination with the 008 session:** it adds a post-gain insert (`setOutputInsert`, destinationGain→destination). This spec adds a sibling pre-gain slot `setPreGainInsert` (channelMerger→destinationGain). Two separate slots, agreed by both sides. Task 2.1 is blocked until the 008 commit lands; rebase onto it first.
- **Owner decisions:**
  - A header and compact-bar button plus the settings section.
  - Alt+Shift+←/→, not handled while the editor or an input has focus.
  - An 8 s reach.
  - Instant release on the beat.
- **Produced:** `functional-spec.md` (Approved), `technical-considerations.md` (Approved), `tasks.md`.
- **Flow defects found:**
  - CLAUDE.md says preview and main each have their own AudioContext. In fact PreviewEngine shares the main context (own controller and output only).
  - The arguments named `KeyboardShortcutManager` for the shortcut, but it is dead code (never instantiated). Shortcuts live in the `useReplContext.tsx` keydown handler.
  - `AudioMixer` is dead code too (per the 008 investigation).
- **Next:** Step 5. One strudel-audio-engineer dispatch (slices 1, 2 minus 2.1, 5.1) in parallel with one strudel-web-engineer dispatch (slices 3–4, 5.2) against the agreed API. 2.1 goes to the audio agent via SendMessage once 008 lands.
