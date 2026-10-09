---
description: Fixes one strudel-client bug end-to-end — GitHub issue or symptom → reproduce → root cause across every surface → fix + proven regression test → verify → review → push gate → prod verified by sha.
argument-hint: '[GitHub issue # / URL, or the symptom — page, action, what happened vs. expected]'
---

# Fix a Bug End-to-End

This is the bug-shaped sibling of `/ship`, adapted from Weaver's `/fix` and Citation's `/fix-bug`. It uses the same **Run Discipline**, push gate and deploy verification. Read `.claude/commands/ship.md` → "Run Discipline", Step 9 (push gate) and Step 10 (deploy), and apply them here unchanged.

## Arguments

`$ARGUMENTS` accepts either of these:
- A GitHub issue number or URL.
- A symptom, for example "switching tracks while playing drops the last edit" or "EQ clicks on preset change".

If `$ARGUMENTS` is empty, ask.

### Step 1: Gather (inline)

- **Issue:** read it with `gh issue view <n> --repo dygy/strudel-client --comments`.
- **Symptom only:** restate it as where (page or URL, panel), what action, expected versus actual, logged in or out, which browser, since when. Ask once for whatever is missing.
- **Check what's already known:**
  - The memory index.
  - `context/product/feature-map.md`, to find the area, its spec and its tests.
  - `git log --oneline -- <area paths> | head -20`, since recent changes are the usual suspects.

### Step 2: Detect the Entry Point

Resume from the owning spec's `flow-log.md`. If there's no spec, use a `fix-log.md` in the scratchpad. If commits for the fix are already on `origin/main`, the fix is delivered, so go straight to verification.

### Step 3: Prepare

Do this exactly as in `/ship` Step 3.

### Step 4: Reproduce, then diagnose

Reproduce **before** you theorise. Use the cheapest faithful path:
- **A failing vitest test** when the logic is reachable in node.
- **`pnpm dev` + Playwright** against `http://localhost:4321` for UI, routing or save behaviour.
- **Prod**, `https://strudel.dygy.app`, read-only, when the bug only happens there. Typical reasons are the Worker runtime, the Cloudflare build or real Supabase data. Use `pnpm deploy:cloudflare:logs` (`wrangler tail`) for server errors.
- **Audio:** use `browser_evaluate` to measure gain values, node counts and context state. "It clicks" becomes a number.

Then find the root cause, inline:
- **Enumerate every surface that shares the code path**, and give each one a verdict. For example, a save bug: autosave, emergency save, the explicit save, import and bulk-create, the admin read-only view. A routing bug: sidebar click, URL load, reload, back and forward, the random `/repl` redirect. A fix that covers only the named surface comes back reopened.
- **Check the usual suspects:**
  - A race between autosave and track switch.
  - Multiple `AudioContext`s (preview versus main).
  - Gain jumps instead of ramps.
  - A code path that works under the dev Astro config but not under `astro.config.cloudflare.mjs`.
  - A Node API in Worker code.
  - RLS denying silently (Supabase returns an empty result, not an error).
  - An i18n key missing from one locale.
  - A slug collision in `slugUtils`.
- Label every claim **verified** (you read the line or ran the command) or **hypothesis**.
- If you can't reproduce it, report what you checked and stop.

### Step 5: Classify (inline)

Find the owning spec (`context/spec/*/functional-spec.md`), then classify:
- **Conformance:** the code violates a correct spec. Fix it and add a regression test.
- **Divergence:** the spec is wrong, or the fix changes specified behaviour. Fix it, add a test, then amend the spec (Step 9).
- **No owning spec:** record "none". Never fabricate one.

Also decide whether **stored user data needs repair**, for example tracks saved corrupted or folders orphaned. If it does, the repair is its own gated step (Step 11), never folded silently into the code fix.

### Step 6: Fix + Regression Test — one dispatch

Dispatch the owning specialist **once**, covering both the fix and the regression test. The brief includes:
- The root cause and every confirmed surface from Step 4.
- The classification.
- "Commit nothing."
- Scope: the root cause, not the symptom.
- The definition of done from the agent's file.

Do a one-line fix inline instead.

### Step 7: Prove the Regression Test (inline)

1. Copy the fix files aside (never `git stash`).
2. Run the test and watch it fail.
3. Restore the files, run it again and watch it pass.
4. Log both outputs.

If the test is green on the old code, it's vacuous. Send it back to the **same** specialist via `SendMessage`.

### Step 8: Verify

- Run the suites in `context/product/static-suites.md`, and `pnpm build:cloudflare` if the website is affected.
- **Re-run the Step 4 reproduction** with the fixed code, for every surface marked as affected.

### Step 9: Amend the spec (divergence only)

Ask with `AskUserQuestion` whether to amend or to leave it as a pending divergence. Unanswered means don't. To amend, run `/awos:spec` in update mode on the owning dir.

### Step 10: Review, commit, push gate, deploy

1. Run one `strudel-reviewer` and save its report to `review/fix-<id>.md`.
2. Collect keep/drop decisions, send accepted findings to the same specialist, and re-run the suites.
3. Commit as `fix(<scope>): <summary> (#<issue>)`.
4. Run the push gate and the deploy exactly as in `/ship` Steps 9–10. The push-gate summary includes the data-repair plan, if there is one.

### Step 11: Data repair (if any) — its own hard stop

1. Write the plan:
   - Which users and rows, with counts measured with a read-only select.
   - The exact SQL.
   - How you'll verify it.
   - How to undo it (snapshot the affected rows first).
2. Ask with `AskUserQuestion`: run now, or not now. Unanswered means not now.
3. Run it, then **verify the effect**: re-measure the counts. Never trust a success exit code.

### Step 12: Close the loop

- **Issue:** comment with the root cause (one paragraph), the surfaces fixed, the shas and the prod verification, after an apply/edit question. Close it only after verifying on prod.
- **Feature map:** update the Tests column if a new test file was added.
- **Memory:** add or update a note with the root cause and the trap, so it's caught faster next time.
- **Report:**
  - The root cause, verified.
  - Surfaces and their verdicts.
  - The shas and deploy state.
  - Repair state.
  - Review findings.
  - **Agents dispatched (count).**
  - Flow defects.
