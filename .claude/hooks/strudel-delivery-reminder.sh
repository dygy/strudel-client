#!/usr/bin/env bash
#
# Strudel delivery reminder — adapted from Weaver's weaver-delivery-reminder.sh
# and Citation's citation-ticket-flow.sh.
#
# A PostToolUse hook on Bash. When a push to `main` actually succeeds in
# strudel-client (= GitHub Actions builds and deploys PROD to Cloudflare), it
# hands Claude the bookkeeping that ships with a delivery.
#
# ADVISORY. Never blocks, never exits non-zero, never writes anywhere but its
# own dedup marker.

set -uo pipefail   # deliberately not -e: every failure here must be silent

emit() {
  jq -cn --arg c "$1" \
    '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}' \
    2>/dev/null || true
  exit 0
}

command -v jq >/dev/null 2>&1 || exit 0
payload="$(cat 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0
jqr() { printf '%s' "$payload" | jq -r "$1" 2>/dev/null || printf ''; }

[ "$(jqr '.tool_name // ""')" = "Bash" ] || exit 0
cmd="$(jqr '.tool_input.command // ""')"
printf '%s' "$cmd" | grep -qE '(^|[;&|(])[[:space:]]*([A-Z_]+=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push' || exit 0

response="$(jqr 'if (.tool_response | type) == "object"
                 then ((.tool_response.stdout // "") + "\n" + (.tool_response.stderr // ""))
                 else (.tool_response // "" | tostring) end')"

# git prints the ref update line only once the remote accepted it.
update="$(printf '%s' "$response" | grep -E '[[:space:]]->[[:space:]]+main[[:space:]]*$' | grep -vE '\[rejected\]|! \[' | head -1)"
[ -n "$update" ] || exit 0
printf '%s' "$response" | grep -qiE '(^|[[:space:]])(error|fatal):|failed to push' && exit 0
newsha="$(printf '%s' "$update" | grep -oE '\.\.[0-9a-f]{7,}' | tr -d '.' | head -1)"

cwd="$(jqr '.cwd // ""')"
[ -d "$cwd" ] || cwd="$PWD"
case "$(git -C "$cwd" remote get-url origin 2>/dev/null)" in *strudel-client*) ;; *) exit 0 ;; esac

state_dir="${TMPDIR:-/tmp}/claude-strudel-delivery/$(jqr '.session_id // "nosession"')"
mkdir -p "$state_dir" 2>/dev/null || exit 0
mkdir "$state_dir/${newsha:-main}" 2>/dev/null || exit 0

emit "Delivery reminder (advisory, from .claude/hooks/strudel-delivery-reminder.sh).
strudel-client${newsha:+ @ ${newsha}} was pushed to main — GitHub Actions now builds and deploys PROD (Cloudflare Workers).
Bookkeeping that ships with it — do what applies, without being asked, and say which you skipped and why:
  1. Pin the deploy run to the sha: gh run list --repo dygy/strudel-client --json headSha,status,conclusion,name,databaseId | jq '[.[]|select(.headSha|startswith(\"${newsha:-<sha>}\"))]'
     Watch it in the background (gh run watch <id> with run_in_background) — don't poll inside the turn.
  2. Verify the served artifact / behaviour on prod before calling it live — a green run alone proves nothing.
  3. Spec bookkeeping: flow-log.md entry, functional-spec Status -> Completed, tick context/product/roadmap.md.
  4. GitHub issue (if any): comment with what shipped + sha, close only if verified on prod.
This is a reminder only, not a sign that anything was recorded."
