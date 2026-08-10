#!/usr/bin/env bash
# Canonical fingerprint of "the open changes" — the single definition of what a
# verdict is pinned to. Both halves of the skill call THIS script: the review
# stores its output in verdict.json, and check-gate.sh recomputes it to decide
# whether that verdict still describes the tree. One formula, one file, so the
# gate and the review can never drift apart.
#
# Covers: the comparison base, the committed diff, the staged+unstaged diff, the
# porcelain status (catches adds and deletions), and the CONTENT of every
# untracked file. Any edit, add, stage, delete, commit or amend changes it.
#
# usage: diff-hash.sh          → the hash
#        diff-hash.sh base     → the base sha it was computed against
#
# PR_SELF_REVIEW_BASE overrides the base ref; otherwise origin/main, then main.

set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || {
  echo "diff-hash: not inside a git repository" >&2
  exit 1
}

# The verdict lives in the working tree, so writing it would otherwise change
# the very hash it stores and every verdict would be born stale.
EXCLUDE=(':(exclude).claude/.pr-self-review')

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi
}

base_ref() {
  if [ -n "${PR_SELF_REVIEW_BASE:-}" ]; then printf '%s\n' "$PR_SELF_REVIEW_BASE"; return; fi
  for ref in origin/main main; do
    if git rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then printf '%s\n' "$ref"; return; fi
  done
  printf 'HEAD\n'
}

base_sha() {
  git merge-base HEAD "$(base_ref)" 2>/dev/null || git rev-parse HEAD
}

if [ "${1:-}" = "base" ]; then
  base_sha
  exit 0
fi

b=$(base_sha)
{
  printf 'base:%s\n' "$b"
  git diff --no-color "$b"...HEAD -- . "${EXCLUDE[@]}" 2>/dev/null
  git diff --no-color HEAD -- . "${EXCLUDE[@]}" 2>/dev/null
  git status --porcelain -uall -- . "${EXCLUDE[@]}" 2>/dev/null
  git ls-files --others --exclude-standard -z -- . "${EXCLUDE[@]}" 2>/dev/null |
    while IFS= read -r -d '' f; do
      printf '%s %s\n' "$f" "$(git hash-object "$f" 2>/dev/null)"
    done
} | sha256 | cut -d' ' -f1
