#!/usr/bin/env bash
#
# Strudel push gate — the strudel-client counterpart of Weaver's
# weaver-push-gate.sh and Citation's citation-branch-current.sh.
#
# A PreToolUse hook on Bash. A push to `main` builds and deploys PROD to
# Cloudflare Workers (.github/workflows/deploy.yml), and CI's test job is
# advisory, so nothing else stops a regression from going live. Before the push
# goes out this runs the WHOLE vitest suite (~3 s, 659 tests on 2026-10-08) and
# compares the failing files against the known-red baseline in
# context/product/known-red-tests.txt.
#
# It BLOCKS only on a verified NEW failure in a CLEAN tree. Everything else is
# reported, never silently passed:
#   - check could not run (no pnpm, no node_modules, vitest crashed) -> allowed + systemMessage
#   - new failure but the tree has uncommitted changes               -> allowed + systemMessage
#   - failure that is on the known-red list                          -> allowed + systemMessage
# Bypass one command: STRUDEL_SKIP_PUSH_GATE=1 git push ...  (say so in the report)
#
# STRUDEL_PUSH_GATE_DEBUG=1 dumps the payload to $TMPDIR/claude-strudel-push-gate/.

set -uo pipefail

allow_quiet() { exit 0; }
allow_note() {
  jq -cn --arg m "$1" '{systemMessage: $m}' 2>/dev/null || true
  exit 0
}
deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}' \
    2>/dev/null || { printf '%s\n' "$1" >&2; exit 2; }
  exit 0
}

command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0
state_dir="${TMPDIR:-/tmp}/claude-strudel-push-gate"
if [ "${STRUDEL_PUSH_GATE_DEBUG:-}" = "1" ]; then
  mkdir -p "$state_dir" && printf '%s\n' "$payload" >"$state_dir/payload.json"
fi
jqr() { printf '%s' "$payload" | jq -r "$1" 2>/dev/null || printf ''; }

[ "$(jqr '.tool_name // ""')" = "Bash" ] || allow_quiet
cmd="$(jqr '.tool_input.command // ""')"

# Heredoc bodies are prose (commit messages), not commands.
cmd_nohd="$(printf '%s\n' "$cmd" | awk '
  inhd { if ($0 ~ "^[[:space:]]*" tag "[[:space:]]*$") inhd=0; next }
  { print }
  match($0, /<<-?[[:space:]]*["'\'']?[A-Za-z_]+/) {
    t=substr($0, RSTART, RLENGTH); gsub(/<<-?[[:space:]]*["'\'']?/, "", t); tag=t; inhd=1 }')"

# A real `git push` at the start of a segment — not a grep/echo that names it.
seg="$(printf '%s\n' "$cmd_nohd" | tr ';&|' '\n\n\n' | grep -E '^[[:space:]]*(\(|env[[:space:]]+)?(STRUDEL_SKIP_PUSH_GATE=1[[:space:]]+)?git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push([[:space:]]|$)' | head -1)"
[ -n "$seg" ] || allow_quiet

printf '%s' "$seg" | grep -q 'STRUDEL_SKIP_PUSH_GATE=1' &&
  allow_note "Strudel push gate BYPASSED (STRUDEL_SKIP_PUSH_GATE=1) — say so in the report."

# Which repo: honour `git -C <dir>`, else the session cwd.
cwd="$(jqr '.cwd // ""')"
[ -d "$cwd" ] || cwd="$PWD"
dir="$(printf '%s' "$seg" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | awk '{print $3}')"
[ -n "$dir" ] && { case "$dir" in /*) ;; *) dir="$cwd/$dir" ;; esac; [ -d "$dir" ] && cwd="$dir"; }
root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || allow_quiet
case "$(git -C "$root" remote get-url origin 2>/dev/null)" in *strudel-client*) ;; *) allow_quiet ;; esac

# Only pushes that land on main. Explicit refspec `x:main` / `main`, or a bare
# `git push` while on main.
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)"
args="$(printf '%s' "$seg" | sed -E 's/.*[[:space:]]push([[:space:]]|$)//')"
if printf '%s' "$args" | grep -qE '(^|[[:space:]:])main([[:space:]]|$)'; then :
elif [ "$branch" = "main" ] && ! printf '%s' "$args" | grep -qE '[[:space:]][^-[:space:]][^[:space:]]*[[:space:]]+[^-[:space:]]'; then :
else allow_quiet; fi
printf '%s' "$args" | grep -qE -- '--dry-run|(^|[[:space:]])-n([[:space:]]|$)|--delete' && allow_quiet

command -v pnpm >/dev/null 2>&1 && [ -d "$root/node_modules" ] ||
  allow_note "Strudel push gate could NOT run (pnpm or node_modules missing) — the suite is unverified. Say so before calling it safe."

git -C "$root" fetch -q origin main 2>/dev/null
changed="$(git -C "$root" diff --name-only origin/main...HEAD 2>/dev/null)"
[ -n "$changed" ] || allow_quiet

mkdir -p "$state_dir" 2>/dev/null
out="$state_dir/vitest-$$.json"
( cd "$root" && pnpm exec vitest run --reporter=json --outputFile="$out" >/dev/null 2>&1 )
[ -s "$out" ] || allow_note "Strudel push gate could NOT run: vitest produced no report (crashed or timed out). The suite is unverified — run 'pnpm exec vitest run' and quote it."

failing="$(jq -r --arg r "$root/" '.testResults[] | select(.status=="failed") | .name | ltrimstr($r)' "$out" 2>/dev/null | sort -u)"
total="$(jq -r '.numTotalTests // 0' "$out" 2>/dev/null)"
rm -f "$out"
[ -n "$failing" ] || allow_note "Strudel push gate: vitest green (${total} tests)."

known="$root/context/product/known-red-tests.txt"
new="$(printf '%s\n' "$failing" | grep -vxF -f <(grep -vE '^[[:space:]]*(#|$)' "$known" 2>/dev/null) 2>/dev/null)"
[ -f "$known" ] || new="$failing"
[ -n "$new" ] || allow_note "Strudel push gate: only known-red test files failed (context/product/known-red-tests.txt):
$failing"

if [ -n "$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  allow_note "Strudel push gate: NEW test failures, but the tree has uncommitted changes so they may not be what is pushed — verify before calling it safe:
$new"
fi

deny "Strudel push gate: this push deploys PROD and these test files fail but are not on the known-red list (context/product/known-red-tests.txt):
$new
Fix them, or if the failure is pre-existing on origin/main, prove that and add the file to the known-red list. Bypass once with STRUDEL_SKIP_PUSH_GATE=1 git push … and say so."
