<!-- not-user-reviewed -->

# Tasks: Strudel for AI Assistants (MCP Server)

Spec: [functional-spec.md](./functional-spec.md) · Tech: [technical-considerations.md](./technical-considerations.md)

Prod steps below need an explicit yes each: turning on dynamic client registration, any `wrangler deploy`, publishing to npm.

- [x] **Slice 1: Spike: a real assistant connects to a minimal server**

  > Settles what docs don't: revocation timing, route in front of the custom domain, WebSocket through it, real CPU time. Findings amend the tech spec before anything else is built.
  - [x] Scaffold `packages/mcp-worker` (`wrangler.jsonc`, handler for `initialize`, `ping`, `tools/list`, `tools/call`) with one tool, `whoami`; serve `/.well-known/oauth-protected-resource/mcp` and the 401 challenge; check tokens via `/auth/v1/user` + `client_id`. **[Agent: strudel-web-engineer]**
  - [x] Add `website/src/lib/oauthServerApi.ts` and the `/oauth/consent` page in its minimum form (client name, Allow, Deny; login round trip keeps `authorization_id`). **[Agent: strudel-web-engineer]**
  - [x] Minimal `TabRelay` with one socket and echo, to test WebSocket through the route. **[Agent: strudel-web-engineer]**
  - [x] Verify (approved prod steps): turn on dynamic registration; deploy the Worker on its routes; connect Claude Code and claude.ai; time the refusal after revoking the grant; open the socket through the route; read `cpuTime` from observability for each handler; confirm the REPL and `/api/*` are unaffected. Record the numbers in `flow-log.md`, amend the tech spec, set the online check limit from the measurement. Delete verification artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 2: Version checks protect saves, with no assistant involved yet**

  > Ships value alone: the same track open in two tabs can no longer overwrite itself.
  - [x] `/api/tracks/update` and `/api/tracks/delete`: optional `expectedVersion`, compare-and-swap on `updated_at`, 409 `version_conflict`. **[Agent: strudel-web-engineer]**
  - [x] `website/src/repl/trackVersion.ts`; `secureApi.updateTrack` sends the version and raises `VersionConflictError`; all save paths (strict autosave, Cmd+S, save-before-switch, emergency save) keep working. **[Agent: strudel-web-engineer]**
  - [x] Detection by 20 s visible poll, `visibilitychange` and 409; false-conflict filter; pause autosave; `localStorage` draft. **[Agent: strudel-web-engineer]**
  - [x] `components/TrackConflictNotice.tsx` with **Load the new version** and **Keep mine**, including the deleted-track case; 9 locales. **[Agent: strudel-web-engineer]**
  - [x] Verify: two tabs on one track in Playwright, with music playing: notice within 30 s, both buttons, reload keeps the draft, a track switch race loses nothing, a folder move raises no notice, plain typing raises no notice. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 3: Consent and Connected assistants, finished**
  - [x] Finish the consent page: full capability list including permanent deletion, redirect host, localhost warning, denied and error states, 9 locales, RTL. **[Agent: strudel-web-engineer]**
  - [x] `panel/ConnectedAssistants.tsx`: list, Disconnect, empty state with link; desktop and compact. **[Agent: strudel-web-engineer]**
  - [x] Verify: Allow, Deny, disconnect then refused; empty state; one RTL locale; phone width. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 4: An assistant reads the library**
  - [x] `list_folders`, `search_tracks` (keyset paging, page size 50, no `code` in lists), `get_track` (steps, version, web address) with plain `fetch` to Supabase REST. **[Agent: strudel-web-engineer]**
  - [x] Rate-limit binding (120/min per user), stable error codes, logging without code or tokens, server `instructions`, tool annotations and output schemas. **[Agent: strudel-web-engineer]**
  - [x] Verify: connect a real client; search by name and by code text; page to the end with each track once; another user's track id gives "Track not found"; CPU within budget. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 5: An assistant changes the library**
  - [x] `SITE` service binding; `create_track`, `update_track`, `move_track`, `set_track_steps`, `create_folder`, `rename_folder`, `move_folder` through the existing routes, with `expectedVersion`, 512 KB limit and all-or-nothing. **[Agent: strudel-web-engineer]**
  - [x] `delete_track`, `delete_step`, `delete_empty_folder`, with destructive hints; new `DELETE /api/folders/delete` refusing non-empty folders. **[Agent: strudel-web-engineer]**
  - [x] Verify: create and reload in the sidebar; stale version refused; taken name refused; deleting a non-empty folder refused; an open tab shows the notice after an assistant's save and after its delete. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 6: An assistant looks things up and checks code**
  - [x] Build step: function index from `doc.json` into `src/generated/`, sound list snapshot script; wire into the build. **[Agent: strudel-web-engineer]**
  - [x] `lookup_function`, `search_functions`, `list_sounds`. **[Agent: strudel-web-engineer]**
  - [x] `src/check.ts`: syntax, mini-notation and unknown-function warnings with suggestions; `check_code` with the online limit and `use_local_helper` answer. **[Agent: strudel-web-engineer]**
  - [x] Verify: the spec's cases (`.lowpas(`, unbalanced brackets, over-limit); CPU within budget on the largest allowed input. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 7: Pattern runs in the local helper**
  - [x] `packages/mcp-local`: stdio server, QuickJS sandbox with `core`, `mini`, `tonal`; `$:`/`.p()` stacking; stubs for loaders, reported as skipped. **[Agent: strudel-engine-engineer]**
  - [x] `run_pattern` and `summarize_pattern`: default 4 cycles, max 64, 2,000 event cap, 10 s stop, memory limit; `check_code` of any size, using the shared check. **[Agent: strudel-engine-engineer]**
  - [x] Package for npm as `strudel_mcp_js`, AGPL-3.0-or-later, runnable by `npx`. Publishing is a separate approved step. **[Agent: strudel-engine-engineer]**
  - [x] Verify: run from a packed tarball in Claude Code: `s("bd sd")` gives 4 events in 2 cycles; infinite loop stops and the next run works; file and network attempts fail; events match the browser engine for several sample tunes. Delete artifacts. **[Agent: strudel-engine-engineer]**

- [x] **Slice 8: An assistant controls an open tab**
  - [x] Full `TabRelay`: keyed by verified user id, Origin and cookie checked at the upgrade, token message on refresh, hibernation, command/ack with timeouts, refusal codes. **[Agent: strudel-web-engineer]**
  - [x] `website/src/repl/assistantControl/{client,handlers}.ts`, using the same functions as the user's buttons; save first, refuse on failure; CodeMirror transaction so Undo works; refuse during a transition or an open conflict. **[Agent: strudel-web-engineer]**
  - [x] **Allow assistant control** switch, indicator (header and compact), short messages, 9 locales; memory-only state. **[Agent: strudel-web-engineer]**
  - [x] `list_tabs`, `play`, `stop`, `update_code`, `open_track`. **[Agent: strudel-web-engineer]**
  - [x] Verify by measurement in a browser: master gain over time during `update_code` shows no dip; the selected transition is used on switch; node counts are stable after N updates; bad code leaves music playing; Undo restores; two tabs give `ambiguous_tab`; switch off gives refusal within 5 s; another user can't see the tab; embed has no switch. Delete artifacts. **[Agent: strudel-audio-engineer]**

- [x] **Slice 9: Setup page and deploy pipeline**
  - [x] `website/src/pages/learn/ai-assistants.mdx`: connect common assistants, install the helper, capabilities, disconnect. Readable signed out. **[Agent: strudel-web-engineer]**
  - [x] Connect UI in `panel/ConnectedAssistants.tsx`: address and commands with **Copy** and a clipboard fallback, steps per assistant, helper install, open when empty and collapsed otherwise, list refresh every 30 s while open; 9 locales; desktop, phone, RTL. **[Agent: strudel-web-engineer]**
  - [x] `.github/workflows/deploy.yml` deploys `strudel-mcp` after `strudel-client`, behind `check`; root scripts for dev and build. **[Agent: strudel-web-engineer]**
  - [x] Verify: `pnpm build:cloudflare` passes with size reported; `wrangler deploy --dry-run` for the new Worker reports its size; a fresh user follows the page for Claude and connects. Delete artifacts. **[Agent: strudel-web-engineer]**

- [x] **Slice 10: Feature Testing & Regression**

  > Verifies the whole feature end-to-end against functional-spec.md, run after all implementation slices are complete.
  - [x] Read functional-spec.md acceptance criteria in full. Generate acceptance-level tests that verify the entire feature as a whole — not individual slices. Cover applicable layers (unit for pure logic, integration for service interactions, e2e for user flows) based on the project's testing stack. Write tests with RED validation (must fail before implementation is confirmed done). Annotate each test with `@spec: 018-strudel-mcp-server` and `@regression` if suitable for long-term regression. Includes the protocol conformance test with the official SDK client, per-tool CPU budget tests and `serviceKeyScope` for the new package. **[Agent: strudel-test-engineer]**
  - [x] Run all generated tests. All must pass. Fix any failures before proceeding. **[Agent: strudel-test-engineer]**

- [x] **Slice 11: Bookkeeping**
  - [x] `context/product/feature-map.md` row with code, spec, tests and owner. No migration needed; `localeCompleteness.test.ts` confirms the strings in all 9 locales. **[Agent: strudel-web-engineer]**
