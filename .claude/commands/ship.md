---
description: Ships one strudel-client feature end-to-end — idea / GitHub issue → AWOS spec/tech/tasks → one specialist per area → verify → review → push gate → prod deploy verified by sha → feature map + roadmap + memory.
argument-hint: '[GitHub issue # / URL, an existing context/spec dir, or a one-line feature description]'
---

# Ship a Feature End-to-End

This drives one feature through spec → implementation → verify → review → prod deploy → bookkeeping. It is adapted from Weaver's `/ship` and Citation's `/implement-feature` to how strudel-client actually ships. It is **one repo** (`github.com/dygy/strudel-client`), with work committed on `main`, and **a push to `main` builds and deploys PROD** (`strudel.dygy.app`, Cloudflare Workers) with no staging. That push is this flow's merge gate.

Run it from a session anchored at the repo root. The `/awos:*` commands resolve `.awos/` from there.

## Arguments

`$ARGUMENTS` accepts any of these:
- A GitHub issue number or URL. Fetch it with `gh issue view <n> --repo dygy/strudel-client --comments`.
- An existing spec dir under `context/spec/`. Resume it.
- A one-line description. There is no issue in that case, so don't create one unless asked.

If `$ARGUMENTS` is empty, ask.

## Run Discipline

**Agent budget** (root `CLAUDE.md` → "Orchestrating agents"):
- Work inline by default. `gh`, git, reading code, running vitest and reading logs all happen in the main context.
- Use subagents only for these:
  1. Implementation: **one specialist per affected area**, never one per task.
  2. **One** `strudel-test-engineer` dispatch for the Feature Testing slice.
  3. Deep reading of an area you haven't opened this session.
  4. Review: one `strudel-reviewer`.
- Follow-ups go to the **same** agent via `SendMessage`.
- Expect 2–4 dispatches. Past 6, stop and tell the user why.
- Every report is a claim. Re-read the named lines or re-run the named command before acting on it.

| Area (see `context/product/feature-map.md` Owner column) | Specialist |
|---|---|
| `website/`, `packages/codemirror`, Supabase, routing, i18n, admin, embed, build | `strudel-web-engineer` |
| `packages/{mixer,equalizer,superdough,supradough,webaudio,sampler,soundfonts,midi,osc}`, `website/src/repl/recording` | `strudel-audio-engineer` |
| `packages/{core,mini,mondo,tonal,xen,transpiler,tidal,hs2js}` | `strudel-engine-engineer` |
| Tests (Feature Testing slice) | `strudel-test-engineer` |

**Questions.**
- Ask fixed-choice questions through `AskUserQuestion`, with the default marked.
- An unanswered question takes the safe default, and you say so.
- An unanswered question **never** authorises an irreversible or outward step. These include a push to `main`, prod Supabase SQL, a `wrangler` secret or deploy, and commenting on or closing an issue. For those, no answer means no.

**Flow log.** From Step 4 on, append a short entry per completed stage to `context/spec/<SPEC_DIR>/flow-log.md`. Each entry records the stage, what it produced (paths and commits), decisions, and the next stage. Resume reads it.

**Flow defects.** If a fact in this command turns out to be wrong, follow reality and note it. List it in the Step 12 report. Don't edit this command, or any agent, during the run.

**Don't babysit.** Watch deploys with `run_in_background` (`gh run watch <id>`), report their state, and keep working.

### Step 1: Gather (inline)

- Collect the issue: body, comments, linked URLs. List any linked source you couldn't reach rather than skipping it.
- Check what the repo already knows. Look up the subject in `context/product/feature-map.md`, grep `context/spec/` (001–014 are migrated Kiro specs) and check the memory index. A half-built predecessor, such as the tree filesystem in spec 002, changes the plan.

### Step 2: Detect the Entry Point

- Glob `context/spec/*/flow-log.md` for this feature, and resume after its last completed stage.
- For spec stages, files on disk win over the log: skip `/awos:spec` if `functional-spec.md` exists, and the same for tech and tasks.
- Never repeat a completed stage.

### Step 3: Prepare the Workspace

Do this in one pass, inline:
- `git status --short` must be clean. If there are foreign uncommitted changes, stop and ask; never stash them away.
- Be on `main`, then run `git pull --ff-only` and `gh auth status`.
- `review/` and `docs/screenshots/` hold working evidence and are git-ignored. Confirm with `git check-ignore review/x docs/screenshots/x`.

### Step 4: Specs and Tasks

1. **`/awos:spec`** (main context). Let `.awos/scripts/create-spec-directory.sh` allocate `NNN-<slug>`. Pass it the Step 1 bundle so it doesn't fetch again.
   - `functional-spec.md` links the issue, if there is one, and lists `## Affected areas`.
   - Acceptance criteria must be testable, and each one maps to a test or a named manual check.
   - Strudel-specific behaviours the spec must state when they're touched:
     - What happens to unsaved work.
     - What the user hears during the change (no clicks or gaps).
     - Behaviour when logged out.
     - Behaviour in the admin read-only view.
     - Which of the 9 locales get new strings.
2. **`/awos:tech`** (main context), run once. It produces one `technical-considerations.md` that names concrete files per area, plus these sections:
   - **Data:** Supabase tables and columns, RLS policies, a migration file under `supabase/migrations/`, and the `supabase_schema.sql` update. Note that `tracks` is the live store.
   - **Runtime:** which code runs in the Worker (SSR and API) and which in the browser, any new SSR pages (they count toward the 3 MiB limit), and new env vars or secrets.
   - **Audio graph** (audio work only): the nodes created and disconnected, the ramps used, and how it interacts with the preview engine.
   - **Upstream impact:** whether any `@strudel/*` public behaviour changes.

   Feed it `context/product/architecture.md`. **Gate:** one review covering all sections.
3. **`/awos:tasks`** (main context), run once, producing `tasks.md`. Tell it **not to ask its review question**. Sanity-check the result yourself:
   - Every task traces to the tech spec and names its path and a `**[Agent: strudel-…]**`.
   - A Feature Testing slice exists.
   - A final **Bookkeeping slice** exists. It covers the `feature-map.md` row, the i18n strings and a migration file where applicable.

Commit the spec dir (`docs(spec): NNN <slug>`), staging only that dir.

### Step 5: Implement — one specialist per area

Don't run `/awos:implement`'s per-task loop, which dispatches one agent per task. Instead:

1. Group the open tasks by Owner area and send one dispatch per group. The `strudel-test-engineer` tasks get **one** dispatch, after implementation. Do small bookkeeping tasks inline.
2. The brief includes:
   - The spec and tech-spec paths. The agent reads them; don't paste them.
   - The task list, verbatim.
   - "Commit nothing."
   - The definition of done from the agent's file. The report must **quote command output**.
3. Order: engine before audio and web when the latter consume a new engine API. Send independent areas in one parallel batch.
4. When a report comes back:
   - Spot-check it: read a few of the named changes and re-run `pnpm exec vitest run`.
   - Tick the tasks `[x]` yourself.
   - Send blocked items to the same agent via `SendMessage`.
5. RED spot-check one test that guards the new behaviour:
   - Copy the implicated files aside (never `git stash`), watch the test fail, restore, and watch it pass.
   - If the test stays green with the feature removed, send it back.

### Step 6: Verify

Run `/awos:verify` (main context) against the spec's acceptance criteria. This is mandatory. Tell it the roadmap item gets ticked in Step 11, not now.

- Run the suites in `context/product/static-suites.md`. The bar is **no new failures** against `known-red-tests.txt`. **`pnpm build:cloudflare` must succeed** for any change the website imports, with the worker size reported.
- **Render every UI change in a real browser.** Run `pnpm dev` and drive `http://localhost:4321` with the Playwright MCP.
  - Exercise the flow and check the console.
  - Check one RTL locale if the layout changed.
  - Save screenshots to `docs/screenshots/NNN-<state>.png` (untracked).
  - Self-certify only objective states. Ask the user to judge look and feel from the screenshots.
- **Audio changes are measured, not listened to.** Use `browser_evaluate` to read gain values over time, node counts before and after N updates, and `AudioContext` state.
- Record coverage in the flow log, per acceptance criterion. Each one is covered by one of: an automated test (say where), a browser check, or nothing (say why it can't be reached).

### Step 7: Local Review

- Dispatch one `strudel-reviewer` on `git diff` plus untracked files, with the spec dir as ground truth.
- Save its report to `review/NNN-<slug>.md`.
- Collect keep/drop decisions via `AskUserQuestion`.
- Send accepted findings to the owning specialist via `SendMessage`, then re-run the suites.

### Step 8: Commit (no push yet)

- Stage only what the flow produced. Never `git add -A`, never `.env` or `.dev.vars`, never `*.png`, and never someone else's work. Surface any unexpected changed files.
- Messages follow `feat(<scope>): <summary> (#<issue>)`, with separate `test(...)`/`docs(...)` commits where natural, and end with the session's attribution lines.

### Step 9: Push Gate — a hard stop

Before the push question, show the user:
1. Review closed out: the review file, every finding kept or dropped, accepted findings fixed, suites green (no new failures).
2. Verification evidence: the coverage record and screenshot paths.
3. Anything that changes for **every** user on deploy: a schema change, a new required env var or secret (`wrangler secret put` must happen **before** the push), or a change to saved-data shape.
4. The **migration plan**, if the schema changes. The SQL is applied to prod Supabase as its own approved step, before the push when the new code needs it.

The `strudel-push-gate` hook runs the whole vitest suite at push time and refuses on a new red. A refusal is a finding to fix, not a bypass to reach for.

Then ask **one** `AskUserQuestion` with these options:
- **Push to main → deploy prod** (recommended once everything above is green)
- **Open a PR first** (`git push -u origin <branch>` + `gh pr create`; CI runs advisory checks, no deploy)
- **Stop here**

Unanswered means stop. "Run it end to end" covers work up to this gate. It is never push approval.

### Step 10: Deploy and Verify on Prod

1. Run `git push origin main`.
2. Pin the run to the sha: `gh run list --repo dygy/strudel-client --json headSha,status,conclusion,databaseId | jq '[.[]|select(.headSha|startswith("<sha>"))]'`. A green list without your sha proves nothing.
3. Watch it in the background.
4. On green, **verify the served artifact**. Open `https://strudel.dygy.app` in Playwright, exercise the changed behaviour, and check the console.
5. If the run is red, read the job log (`gh run view <id> --log-failed`), fix forward, re-run the suites, and ask the push gate again only if the fix changed behaviour.

### Step 11: Close the Loop

Draft each outward write, show it, and ask with `AskUserQuestion` whether to apply or edit it. Unanswered means don't.
- **GitHub issue** (if there is one): comment with what shipped (shas), how it was verified on prod, and known limits. Close it only after verifying on prod.
- **Feature map:** add or update the feature's row in `context/product/feature-map.md`.
- **Roadmap:** tick the item in `context/product/roadmap.md`, and set the spec Status to `Completed`.
  - If `architecture.md` or `product-definition.md` drifted, suggest `/awos:architecture` or `/awos:product` with a prompt. Never auto-edit them.
- **Memory:** write or update one project memory note for the feature: what's live, and the non-obvious traps found in this run.
- Commit the bookkeeping (`docs: …`). This push goes through the gate like any other.

### Step 12: Report

Report:
- Commit shas, the deploy run and how prod was verified, and the issue state.
- Review verdicts, finding counts and the review file path.
- Screenshots.
- **Agents dispatched in this run (count).**
- Flow defects found.

Leave a clean tree.
