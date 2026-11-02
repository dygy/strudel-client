# Flow log: 018 Strudel MCP server

## 2026-11-02: spec, tech, tasks

- **Produced:** `functional-spec.md`, `technical-considerations.md`, `tasks.md` on branch `feat/018-mcp-server`.
- **Owner's decisions:**
  - Remote server plus local helper.
  - All four tool groups: library, knowledge and checks, live control, pattern runs.
  - Full write access including delete, one item at a time, empty folders only.
  - The control switch is per tab, off by default, reset on reload.
  - Stay on Workers Free. Formatting is dropped from MCP rather than pay for the plan.
  - Tech plan accepted, spike first.
- **Measured on prod:**
  - OAuth server already enabled, path `/oauth/consent`, dynamic registration off, ES256 keys.
  - `update_tracks_updated_at` trigger is enabled.
  - Prettier takes 9–33 ms CPU, against the 10 ms Free limit.
  - `supabase-js` installed is 2.48.1, with no `auth.oauth` namespace.
- **Flow defects:** `/ship` says to work on `main`. The session rule is to branch first on the default branch, so this work is on a feature branch. `tasks.md` keeps its `not-user-reviewed` marker because `/ship` tells `/awos:tasks` not to ask.
- **Next:** Slice 1 spike. It needs approval for two prod steps: dynamic registration and deploying the Worker.
