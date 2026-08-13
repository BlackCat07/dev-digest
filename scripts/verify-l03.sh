#!/usr/bin/env bash
#
# Verify L03 — the Intent Layer (L03a) and Smart Diff (L03b), end to end.
#
#   ./scripts/verify-l03.sh            # every gate both packages have for L03
#   ./scripts/verify-l03.sh --server   # server only
#   ./scripts/verify-l03.sh --client   # client only
#   ./scripts/verify-l03.sh --with-db  # also the Postgres-backed integration tests
#
# What it is for: one command that answers "is L03 still whole?" without running
# the two packages' entire suites and reading two screens of output. It runs the
# gates the lesson's own code is subject to, then the L03 test files by name, and
# prints one PASS/FAIL line per gate with a summary at the end.
#
# Every gate runs even after one fails — a run that stops at the first error tells
# you about one problem when there may be four. The exit code is the number of
# failed gates, so CI and `&&` chains still behave.
#
# Binaries are invoked DIRECTLY out of node_modules rather than through
# `pnpm <script>`: pnpm's pre-script dep-status check shells out to `pnpm install`,
# which trips this repo's supply-chain policy and kills the run before the gate
# ever starts (`server/INSIGHTS.md`, 2026-08-02).
#
# The DB-backed half is opt-in (--with-db) because it needs Docker, and because
# vitest silently SKIPS most `.it.test.ts` files in a mixed run even when Docker is
# up — so those are run on their own, serially (`server/INSIGHTS.md`, 2026-08-06).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_SERVER=1
RUN_CLIENT=1
WITH_DB=0

for arg in "$@"; do
  case "$arg" in
    --server)   RUN_CLIENT=0 ;;
    --client)   RUN_SERVER=0 ;;
    --with-db)  WITH_DB=1 ;;
    -h|--help)  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
pass() { printf '\033[1;32m  PASS\033[0m  %s\n' "$*"; }
fail() { printf '\033[1;31m  FAIL\033[0m  %s\n' "$*"; }

FAILED=0
RESULTS=()

# gate <name> <workdir> <command...>
gate() {
  local name="$1" dir="$2"; shift 2
  log "$name"
  if (cd "$dir" && "$@"); then
    pass "$name"; RESULTS+=("PASS  $name")
  else
    fail "$name"; RESULTS+=("FAIL  $name"); FAILED=$((FAILED + 1))
  fi
  echo
}

# ---- server -----------------------------------------------------------------
if [ "$RUN_SERVER" = 1 ]; then
  SB="./node_modules/.bin"
  [ -d "server/node_modules" ] || { echo "server/node_modules missing — run 'pnpm install' in server/" >&2; exit 2; }

  gate "server · typecheck" server "$SB/tsc" --noEmit -p tsconfig.json
  # `tsconfig.json` includes only `src/`, so nothing else in this repo typechecks
  # a TEST file — a fixture can drift out of a port's shape while `vitest` stays
  # fully green (`server/INSIGHTS.md`, 2026-08-10). The wider project is therefore
  # run here, but only L03's own test files are allowed to FAIL it: the tree
  # carries a documented baseline of 16 errors in six unrelated files, and a gate
  # that is red on arrival is a gate nobody reads. The total is printed so growth
  # elsewhere is still visible.
  gate "server · typecheck (L03 test files)" server bash -c '
    out="$(./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json 2>&1)"
    total="$(printf "%s\n" "$out" | grep -c "error TS" || true)"
    printf "  %s type error(s) across all test files (16 is the known baseline)\n" "$total"
    mine="$(printf "%s\n" "$out" | grep -E "^test/(intent|smart-diff)" || true)"
    [ -z "$mine" ] || { printf "%s\n" "$mine"; false; }
  '
  gate "server · eslint" server "$SB/eslint" .
  # Onion layering: reviewer-core stays pure, modules reach the outside only
  # through adapters. L03a added a port (`RepoDocReader`) and an adapter for it.
  gate "server · dependency-cruiser" server \
    "$SB/depcruise" --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
  # The lesson's own hermetic suites, by name.
  gate "server · intent + smart-diff tests" server \
    "$SB/vitest" run --exclude '**/*.it.test.ts' intent smart-diff
  # The classifier's system prompt must tell the model to answer in English, or a
  # Ukrainian/German PR comes back derived in that language and lands in an
  # English UI. It is one line in a `.md`, so nothing else would catch its loss.
  gate "server · intent prompt says answer in English" server \
    grep -qi "in English" src/prompts/intent.classify.system.md

  if [ "$WITH_DB" = 1 ]; then
    gate "server · intent + smart-diff integration (Postgres)" server \
      "$SB/vitest" run --pool=forks --poolOptions.forks.singleFork intent.it smart-diff.it
  fi
fi

# ---- client -----------------------------------------------------------------
if [ "$RUN_CLIENT" = 1 ]; then
  CB="./node_modules/.bin"
  [ -d "client/node_modules" ] || { echo "client/node_modules missing — run 'pnpm install' in client/" >&2; exit 2; }

  gate "client · typecheck" client "$CB/tsc" --noEmit -p tsconfig.json
  gate "client · eslint" client "$CB/eslint" .
  # IntentCard + RiskAreas (L03a), SmartDiffViewer + DiffTab (L03b), and the
  # findings side the diff's badges now navigate INTO.
  gate "client · L03 component tests" client \
    "$CB/vitest" run IntentCard RiskAreas SmartDiffViewer DiffTab FindingsPanel FindingCard ReviewRunAccordion hooks/intent
fi

# ---- summary ----------------------------------------------------------------
printf '\033[1m── verify:l03 ──\033[0m\n'
for line in "${RESULTS[@]}"; do
  case "$line" in
    PASS*) printf '\033[1;32m%s\033[0m\n' "$line" ;;
    *)     printf '\033[1;31m%s\033[0m\n' "$line" ;;
  esac
done

if [ "$FAILED" = 0 ]; then
  printf '\n\033[1;32mL03 verified — %d gates, all green.\033[0m\n' "${#RESULTS[@]}"
else
  printf '\n\033[1;31m%d of %d gates failed.\033[0m\n' "$FAILED" "${#RESULTS[@]}"
fi
exit "$FAILED"
