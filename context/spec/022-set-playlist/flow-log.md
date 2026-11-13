# Flow log — 022 set playlist

## 2026-11-13 — Specs and tasks
- Produced: `functional-spec.md`, `technical-considerations.md`, `tasks.md`.
- Decisions (owner): Supabase table `set_lists`; two-stage Cue → Go; per-item type + length only; hotkey Alt+Shift+N. Tech spec approved in one review.
- Found while exploring: same-id Go would hot-swap (→ `force`); Ctrl+Enter while cued hits speakers (→ redirect to preview while cued); step ids unreliable (→ id/name/index resolution); no per-switch override in the REPL (→ `transition` param); admin view renders the same Panel (→ hide tab).
- Note: spec index 021 was taken by an untracked dir from another session (`021-eq-genre-presets-transparency`), left untouched.
- Next: implementation, one `strudel-web-engineer` dispatch (slices 1–5), then `strudel-test-engineer` (slice 6).
