# Strudel Client — Agent Guide

This is a fork of [Strudel](https://strudel.cc), a browser live-coding environment for algorithmic music. The fork turns it into a personal music workspace:
- a cloud track library (Supabase)
- track URLs
- a mixer with headphone preview, crossfade transitions and a 10-band EQ
- Prettier formatting and smart autocomplete
- audio and screen recording
- 9 locales

It is a pnpm monorepo: `packages/*` (`@strudel/*`), `website/` (Astro + React REPL) and `src-tauri/`. It's deployed as a Cloudflare Worker at **strudel.dygy.app**. Repo: `github.com/dygy/strudel-client`. Upstream: codeberg.org/uzu/strudel.

## Read before you touch anything

| Doc | When |
|---|---|
| [`context/product/feature-map.md`](./context/product/feature-map.md) | **Always first.** Every feature with its code paths, spec, tests and owning agent |
| [`context/product/architecture.md`](./context/product/architecture.md) | Stack, data model, Worker runtime, deploy |
| [`context/product/static-suites.md`](./context/product/static-suites.md) | Which commands to run, their baselines, and what a push triggers |
| [`context/product/known-red-tests.txt`](./context/product/known-red-tests.txt) | The only test files allowed to fail |
| [`context/product/roadmap.md`](./context/product/roadmap.md) and [`product-definition.md`](./context/product/product-definition.md) | What's shipped, what's next, and why |
| `context/spec/NNN-<slug>/` | Per-feature specs. 001–014 were migrated from Kiro and are not in AWOS template format |

## Commands

```sh
pnpm i                      # setup (Node 24.12.0, pnpm 10)
pnpm dev                    # REPL at http://localhost:4321 (Supabase needs website/.dev.vars — see .dev.vars.example)
pnpm exec vitest run        # whole suite, ~3 s
pnpm test                   # same + regenerates doc.json (jsdoc) first
pnpm build:cloudflare       # the PROD build — must pass for any website-affecting change
pnpm deploy:cloudflare:logs # wrangler tail on prod
```

Server code reads env through `website/src/lib/server-env.ts`, not `import.meta.env`, because Cloudflare supplies vars and secrets per request. `SUPABASE_SERVICE_ROLE_KEY` is a Worker secret (`cd website && npx wrangler secret put …`).

## Delivery pipeline — AWOS + `/ship` / `/fix`

Spec-driven development works the same way as in Weaver and Citation. Every feature goes **spec → tech → tasks → implement → verify → review → push gate → prod verified**.

```
.awos/                      AWOS framework (vendored — don't hand-edit, reinstall overwrites)
.claude/commands/awos/      the /awos:* wrappers, vendored at the same pin
.claude/commands/ship.md    /ship — one feature end-to-end
.claude/commands/fix.md     /fix  — one bug end-to-end
.claude/agents/             strudel-{web,audio,engine}-engineer, strudel-test-engineer, strudel-reviewer
.claude/hooks/              strudel-push-gate.sh (blocking), strudel-delivery-reminder.sh (advisory)
context/product/            product-definition · roadmap · architecture · feature-map · static-suites · known-red-tests
context/spec/NNN-<slug>/    functional-spec.md · technical-considerations.md · tasks.md · flow-log.md
review/, docs/screenshots/  working evidence — git-ignored, never committed
```

- **`/ship <issue # | description>`** takes a feature end-to-end:
  1. `/awos:spec`, then `/awos:tech`, then `/awos:tasks`.
  2. One specialist per area implements it.
  3. `/awos:verify`, then a `strudel-reviewer` review.
  4. The push gate, then a push to `main`.
  5. The deploy is verified by sha and on prod.
  6. Feature map, roadmap and memory get updated.
- **`/fix <issue # | symptom>`** takes a bug end-to-end:
  1. Reproduce it first, and check every surface that shares the code path.
  2. Fix it and add a regression test, proven red then green.
  3. Push it through the same gate.
  4. Any data repair is its own approved step.
- **For small changes**, use plain `/awos:spec` → `/awos:tech` → `/awos:tasks` → `/awos:implement` → `/awos:verify`. The same push gate applies.
- **The push gate is the merge gate.** A push to `main` deploys PROD and there is no staging. Neither command pushes without an explicit yes for that push. "Work autonomously" is never that yes.
- **Spec dirs** are `NNN-<slug>`, allocated by `.awos/scripts/create-spec-directory.sh`, with the GitHub issue linked inside.
- **AWOS baseline:** `github.com/provectus/awos` @ `46746bcbcb5171c7d7bc7caa921ac15ccb5c1d93`, migration version 2. This is the same pin as Weaver and Citation. To move it:
  ```sh
  rm -rf /tmp/awos && git clone https://github.com/provectus/awos.git /tmp/awos && git -C /tmp/awos checkout <sha> && node /tmp/awos/index.js --overwrite
  ```
  Run that from this root, then update this line.

## Orchestrating agents (adapted from Citation's CB-1323 run discipline)

A subagent starts cold, re-reads what you already know, and returns a *claim*.

- **Work inline by default.** `gh`, git, vitest, log reading and small investigations all run in the main context. Never dispatch an agent for one tool call.
- **Dispatch only for these:**
  1. Implementation: **one agent per affected area** (web / audio / engine), never one per task.
  2. Deep reading of an area you haven't opened this session.
  3. Independent research questions.

  Send independent dispatches **in one parallel batch**.
- **Producers before consumers.** Engine API changes land before the audio and web code that uses them.
- **Follow-ups reuse the agent.** Send blocked tasks and accepted review findings back with `SendMessage`.
- **Every brief says:**
  - the spec paths (don't paste them)
  - "commit nothing"
  - the definition of done: tests proven red→green, the suite run, **command output quoted as evidence**
- **A report is a claim.** Re-read the named lines or re-run the named command before acting on it.
- **Budget:** typically 2–4 agents per feature. Past 6, stop and tell the user why.

## Hooks

- **Push gate** (`PreToolUse`, blocking). Before a push to `main`, it runs the whole vitest suite and refuses on any failing file that isn't in `known-red-tests.txt`, but only when the tree is clean.
  - It reports instead of blocking when the check can't run or the tree is dirty.
  - To bypass a single push, run `STRUDEL_SKIP_PUSH_GATE=1 git push …` and say so.
- **Delivery reminder** (`PostToolUse`, advisory). After a successful push to `main`, it reminds you to:
  - pin the deploy run to the sha
  - verify prod
  - update the spec, roadmap and issue

## Rules that keep biting

- **No lost work.** Files require login: there's no local file store. Saves go through `globalSaveManager`, strict autosave and emergency save. Treat any change near these as high-risk and test the race with track switching.
- **Audio continuity is the product.** Use gain ramps, never jumps. Disconnect the nodes you create. There are two engines, preview and main, each with its own `AudioContext`.
- **Worker limits.** No Node-only APIs in SSR or API code. Keep pages prerendered unless they need SSR, because the Worker script must stay under 3 MiB.
- **Supabase.** RLS by `auth.uid()` on every table. The service-role key is used in `/api/admin/*` only. `tracks` is the live store; the `tree_*` layer is partial (spec 002). Schema changes ship as a migration file, and are applied to prod only as an approved step.
- **Upstream packages** (`core`, `mini`, `superdough`, …) stay mergeable. Prefer additive changes and say when you diverge. Public functions need JSDoc, which drives the docs and the autocomplete.
- **i18n.** A new string goes into all 9 locales under `website/src/i18n`.
- **CI gates on tests only.** A failing vitest test blocks the deploy. Format and lint are still advisory (pre-existing red, see `static-suites.md`), so the push gate catches regressions before they reach CI, and your own verification remains the gate for behaviour.
