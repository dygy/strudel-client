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

## 2026-11-03: Slice 1 spike on prod (approved)

- **Done:** consent page pushed to main (`d96349b`, run 41548388023 green, page serves 200 with frame and Referer headers). Worker `strudel-mcp` deployed on its routes, version `615044df`. Dynamic registration turned on in prod Supabase.
- **Measured:** see tech spec section 2.3. Revocation 89 ms at `/mcp`; REST token valid until expiry; p50 CPU 0.36 ms, p99 1.33 ms; socket through the route works.
- **Echo:** tested, then gated off with `TAB_ECHO_ENABLED` (prod answers 404).
- **Temporary user and OAuth client:** created by script and deleted (200, 204).
- **Open:** a real client (Claude Code, claude.ai) connecting through Google sign-in, which needs the owner. `scripts/cpu-time.mjs` got 403 with wrangler's login, which has no observability scope; quantiles came from the GraphQL analytics API instead, with few samples (6).
- **Next:** Slice 2.

## 2026-11-03: save protection shipped, tools ready

- **Shipped:** `5289c6c`, run 41659340595. The first push, `68315e8`, failed CI: Node 24 ran out of memory on plain `useFakeTimers`, and this Mac runs Node 26. Verified on prod with a temporary user, 19 of 19, user deleted.
- **On branch:** slices 4 to 10, helper renamed `strudel_mcp_js`.
- **Decision:** shared audio code reverted to main after three review rounds found regressions in it. Pre-existing behaviour left alone, to file: a stale evaluate can win over an edited Update; on Crossfade an edited Update during a slow switch is ignored; a hanging evaluate on Crossfade blocks Update until reload.
- **Open:** real client through Google sign-in; prod CPU for `check_code`; `MCP_RATE` and `MCP_IP_RATE` on Free; publishing the helper.
- **Flow defects:** the push gate runs on the local Node, not CI's.
