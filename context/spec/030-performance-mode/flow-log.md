# Flow log — 030 Performance mode

## 2026-11-15 — Step 1–3: gather, workspace
- No issue (roadmap Phase 6 item). Prior art: zen mode (`isZen`, unmounts panels), set bar (022), EQ output tap (026 `getMainEqualizerOutputTap`), `beforeunload` only for canvas cleanup / emergency save.
- Spec 030 claimed with session strudel-client-4a (it holds 028/029). Worktree `../strudel-client-perf`, branch `feat/performance-mode`, rebased on 28f74c6.
- Owner choices: button + Alt+Shift+P; code + Now/Next + timer + levels, code editable; close guard whenever music plays.

## 2026-11-15 — Step 4: spec, tech, tasks
- `functional-spec.md`, `technical-considerations.md`, `tasks.md`. Clip light at −0.3 dBFS (limiter ceiling) rather than 0 dBFS, since the EQ limiter keeps the output below full scale.
- Decision: hide with CSS, never unmount (zen mode's unmount would drop panel-owned audio state).
- Next: Step 5, audio + web specialists in parallel.
