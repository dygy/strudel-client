# Flow log — 027 tempo-phrase-sync

## 2026-11-14 — spec, tech, tasks
- Roadmap Phase 6 item "Tempo and phrase sync"; no GitHub issue.
- Found while gathering: 017 already has Snap (0/1/4/8, counted from the scheduler's cycle 0) and a Tempo glide checkbox (glide during the overlap; off = the old track jumps to the new tempo at T). So 027 extends both instead of adding a new system.
- Owner decisions (AskUserQuestion):
  - a 4-way Tempo choice (Jump / Glide during / Match, then glide / Keep set tempo) replaces the checkbox;
  - phrases are counted from the playing track's own cycle 0, and 16 is added.
- Also found: the 023 scratch shift moves the audible track. The phrase origin is therefore `controller.origin + scratch shift`, read before `PatternOffset` drops it at switch time (tech §2.1 step 4).
- Spec, tech and tasks were written inline (as in 021 and 024). Workspace: own worktree `../strudel-client-tempo`, branch `feat/tempo-phrase-sync` from origin/main 13e31c5, because the shared checkout is used by other sessions. Spec number 027 was claimed with the 025/026 session.
- Next: implementation: one audio dispatch (Slices 1–2), then one web dispatch (Slice 3), which consumes the controller's `tempo` and `getTrackShift`.
