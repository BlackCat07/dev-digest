#!/usr/bin/env bash
# The merge gate. Wired as a PreToolUse hook on Bash in .claude/settings.json,
# it lets every command through except `gh pr create` / `gh pr merge`, which it
# denies (exit 2) unless a FRESH, non-blocking pr-self-review verdict exists.
#
# Fails OPEN on anything unexpected — no repo, no payload, no verdict directory.
# A broken pre-PR check must never wedge a session; only a recorded
# request_changes, a stale verdict, or a missing one blocks.

set -uo pipefail

# Cheap prefilter FIRST: this runs on every Bash call, so the ignore path must
# not fork a single process.
PAYLOAD=$(cat)
case "$PAYLOAD" in
  *'gh pr create'* | *'gh pr merge'*) ;;
  *) exit 0 ;;
esac

block() {
  printf 'Blocked by the pr-self-review gate: %s\n' "$1" >&2
  exit 2
}

# Extract tool_input.command properly — the substring above is only a superset.
if command -v jq >/dev/null 2>&1; then
  COMMAND=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // ""' 2>/dev/null)
elif command -v node >/dev/null 2>&1; then
  COMMAND=$(printf '%s' "$PAYLOAD" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).tool_input?.command??""))}catch{}})' 2>/dev/null)
else
  COMMAND=$PAYLOAD
fi

# Only when the command is actually INVOKED — at the start or after a shell
# operator. Quoted prose that merely contains the phrase (`grep 'gh pr create'
# docs/`) must pass: a gate with false positives gets switched off, and then it
# protects nothing.
printf '%s' "$COMMAND" |
  grep -Eq '(^|[;&|(]|&&|\|\|)[[:space:]]*(sudo[[:space:]]+)?gh[[:space:]]+pr[[:space:]]+(create|merge)([[:space:]]|$)' ||
  exit 0

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
VERDICT_FILE="$REPO_ROOT/.claude/.pr-self-review/verdict.json"
[ -f "$VERDICT_FILE" ] ||
  block 'no verdict on record for this branch. Run /pr-self-review first.'

read_field() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" \
    "$VERDICT_FILE" 2>/dev/null | head -1 | sed 's/[[:space:]]*$//'
}

recorded=$(read_field diff_hash)
current=$("$(dirname "$0")/diff-hash.sh" 2>/dev/null)
[ -n "$current" ] || exit 0 # cannot verify ⇒ fail open
if [ "$recorded" != "$current" ]; then
  block "the verdict is stale — the tree changed since it was recorded (${recorded:0:12} → ${current:0:12}). Re-run /pr-self-review."
fi

[ "$(read_field verdict)" = "request_changes" ] || exit 0

# An override is a string reason, never a bare null. It clears request_changes,
# but it can never clear staleness — that check already ran above.
if grep -q '"override"[[:space:]]*:[[:space:]]*"[^"]' "$VERDICT_FILE" 2>/dev/null; then
  echo "pr-self-review: request_changes overridden by the author — proceeding." >&2
  exit 0
fi

block "the last review returned request_changes ($(read_field CRITICAL) CRITICAL). Fix them and re-run /pr-self-review, or record an explicit override."
