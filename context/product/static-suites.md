# Static Suites and What a Push Triggers

These are the commands every implementer and reviewer runs, with their measured baselines. The bar for any change is **no new failures** against these baselines. "It was already red" has to be proven against `origin/main`, not asserted.

| Suite | Command | Baseline (measured 2026-10-08 on `d02d450`) |
|---|---|---|
| Unit tests | `pnpm exec vitest run` (whole repo, ~3 s) | 659 tests: 639 pass, 20 fail, all in the 7 files listed in [`known-red-tests.txt`](./known-red-tests.txt) |
| Unit tests, with jsdoc | `pnpm test` | Same as above, plus regenerating `doc.json` first. Use it when touching JSDoc in `packages/{core,mini,codemirror,csound,draw,tonal,transpiler,webaudio}` |
| Lint | `pnpm run lint` | 29 errors pre-existing (CI comment). Judge by no new errors in touched files: `pnpm exec eslint <files>` |
| Format | `pnpm exec prettier --check <touched files>` | 228 files unformatted repo-wide. Only touched files must be clean |
| Prod build | `pnpm build:cloudflare` (~minutes, 4 GB heap) | Must succeed. **This is the deploy.** Run it for any change under `website/` or to a package the website imports, and check that `website/dist/_worker.js` stays under 3 MiB |
| Local run | `pnpm dev` → http://localhost:4321 | Needs `.env` / `website/.dev.vars` for Supabase |

## What a push triggers

| Push | Effect |
|---|---|
| Branch with an open PR | CI `check` job only (advisory). No deploy |
| `main` | CI `check` job (advisory), and **build + `wrangler deploy` to PROD at `strudel.dygy.app`**. There is no staging |

Before any push to `main`, the `strudel-push-gate` hook (`.claude/hooks/strudel-push-gate.sh`) runs the whole vitest suite. It refuses the push when a test file fails that isn't on the known-red list. A refusal is a finding to fix, not a reason to bypass the hook.

Verify a deploy by pinning the run to its sha, then checking what prod serves:

```sh
gh run list --repo dygy/strudel-client --json headSha,status,conclusion,databaseId | jq '[.[]|select(.headSha|startswith("<sha>"))]'
```

A green run alone proves nothing. Load `https://strudel.dygy.app` in Playwright, check the console, and exercise the changed behaviour.
