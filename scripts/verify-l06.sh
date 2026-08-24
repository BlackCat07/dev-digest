#!/usr/bin/env bash
#
# Verify L06 — the Eval Pipeline (SPEC-04), end to end.
#
#   ./scripts/verify-l06.sh            # every gate all three packages have for L06
#   ./scripts/verify-l06.sh --core     # reviewer-core only (the scorer)
#   ./scripts/verify-l06.sh --server   # server only
#   ./scripts/verify-l06.sh --client   # client only
#   ./scripts/verify-l06.sh --with-db  # also the Postgres-backed ordering tests
#
# The selector flags are additive: `--core --server` runs both and skips the client.
#
# What it is for: one command that answers "is L06 still whole?" — and, above all,
# one command that answers the homework's central claim mechanically. The scorer
# makes NO MODEL CALL. That is not a sentence in a README here; it is the gate
# `core · the scorer makes no model call`, which reads the import statements of
# `reviewer-core/src/eval/score.ts` and fails if any of them resolves anywhere but
# `@devdigest/shared`, or names a provider, an HTTP client or a network primitive.
#
# Every gate runs even after one fails — a run that stops at the first error tells
# you about one problem when there may be four. The exit code is the number of
# failed gates, so CI and `&&` chains still behave.
#
# Binaries are invoked DIRECTLY out of node_modules rather than through
# `pnpm <script>`: pnpm's pre-script dep-status check shells out to `pnpm install`,
# which trips this repo's supply-chain policy ([ERR_PNPM_IGNORED_BUILDS]) and kills
# the run before the gate ever starts (`server/INSIGHTS.md`, 2026-08-02).
#
# The DB-backed half is opt-in (--with-db) because it needs Docker, and because
# vitest silently SKIPS most `.it.test.ts` files in a mixed run even when Docker is
# up — so it is run on its own, serially, in a single fork (`server/INSIGHTS.md`,
# 2026-08-06). Read the `↓` lines, not the pass count.
#
# Two grep rules apply to every text gate below and both are load-bearing:
# `-a`, because a handful of `*.ts` files in this repo carry a literal NUL byte and
# a plain `grep` skips them as binary; and `grep` rather than `rg`, because this
# machine has no `rg` binary — it is a shell function the agent harness defines, so
# an `rg` gate dies in any script and in CI. `grep` also exits 1 when it matches
# nothing, which is the PASSING case for the negative gates, so they read the
# output rather than `$?`.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_SERVER=1
RUN_CLIENT=1
RUN_CORE=1
WITH_DB=0
SELECTED=0

select_only() {
  if [ "$SELECTED" = 0 ]; then
    RUN_SERVER=0; RUN_CLIENT=0; RUN_CORE=0; SELECTED=1
  fi
}

for arg in "$@"; do
  case "$arg" in
    --server)   select_only; RUN_SERVER=1 ;;
    --client)   select_only; RUN_CLIENT=1 ;;
    --core)     select_only; RUN_CORE=1 ;;
    --with-db)  WITH_DB=1 ;;
    -h|--help)  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# ---- the AC-98 gate ---------------------------------------------------------
# The scorer's own module, and therefore everything it imports, references no
# model provider, no HTTP client and no network call.
#
# This is checkable by reading ONE file because `score.ts` is written with exactly
# one import statement, a type-only import of `@devdigest/shared`. Assert that and
# the transitive set collapses to the contract package and `zod` — there is no
# graph left to walk.
#
# Scoped to IMPORT STATEMENTS, not whole-file text, and that is not pedantry: a
# text search over this tree flags a doc comment that EXPLAINS why a module does
# not import Node's buffer, and it has already cost two rewordings of prose and one
# `String.prototype.match` written where `.exec()` was natural, purely to satisfy a
# grep (`server/INSIGHTS.md`, 2026-08-19). AC-98 states the constraint for exactly
# this reason. A comment may say `openai`; an import may not.
scorer_no_model_call() {
  local f='src/eval/score.ts'
  local stmts froms bad_target bad_word rc=0

  [ -f "$f" ] || { printf '  %s is missing\n' "$f"; return 1; }

  # Statement heads AND `from '…'` clauses, so a multi-line import cannot hide its
  # target on a continuation line.
  stmts="$(grep -anE "^[[:space:]]*(import|export)[[:space:]]|from[[:space:]]*'" "$f")"
  printf '  %s import/export statement line(s) inspected in %s\n' \
    "$(printf '%s\n' "$stmts" | grep -c . || true)" "$f"

  # 1 — every `from '…'` resolves to the contract package and nothing else.
  froms="$(printf '%s\n' "$stmts" | grep -a "from '" || true)"
  bad_target="$(printf '%s\n' "$froms" | grep -a . | grep -av "from '@devdigest/shared'" || true)"
  if [ -n "$bad_target" ]; then
    printf '  import target outside @devdigest/shared:\n%s\n' "$bad_target"
    rc=1
  fi

  # 2 — no import line names a provider, an HTTP client or a network primitive.
  bad_word="$(printf '%s\n' "$stmts" | grep -a . \
    | grep -aiE 'openai|openrouter|anthropic|llm|provider|fetch|http|node:' || true)"
  if [ -n "$bad_word" ]; then
    printf '  import line names a provider / HTTP client / network primitive:\n%s\n' "$bad_word"
    rc=1
  fi

  [ "$rc" = 0 ] && printf '  no model provider, HTTP client or network import. Scoring is arithmetic.\n'
  return "$rc"
}

# ---- reviewer-core ----------------------------------------------------------
if [ "$RUN_CORE" = 1 ]; then
  KB="./node_modules/.bin"
  [ -d "reviewer-core/node_modules" ] || { echo "reviewer-core/node_modules missing — run 'npm install' in reviewer-core/" >&2; exit 2; }

  gate "core · typecheck" reviewer-core "$KB/tsc" --noEmit -p tsconfig.json
  # `tsconfig.json` includes only `src/`, so the scorer's OWN test file is not
  # typechecked by the gate above — a real `error TS` can sit in it while vitest is
  # fully green. `tsconfig.eslint.json` widens the include for ESLint's parser, so
  # it is borrowed here. Only L06's test file may FAIL this: the tree carries a
  # documented baseline of 4 errors (test/run.test.ts, test/structured.test.ts),
  # and a gate that is red on arrival is a gate nobody reads. The total is printed
  # so growth elsewhere stays visible.
  gate "core · typecheck (L06 test files)" reviewer-core bash -c '
    out="$(./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json 2>&1)"
    total="$(printf "%s\n" "$out" | grep -c "error TS" || true)"
    printf "  %s type error(s) across all test files (4 is the known baseline)\n" "$total"
    mine="$(printf "%s\n" "$out" | grep -E "^test/eval-score" || true)"
    [ -z "$mine" ] || { printf "%s\n" "$mine"; false; }
  '
  gate "core · scorer tests" reviewer-core "$KB/vitest" run --passWithNoTests eval-score
  gate "core · the scorer makes no model call" reviewer-core scorer_no_model_call
  # DDG-WIRE-002 over this package. No `db/schema` here, so no exclusion.
  gate "core · ESM extensions" reviewer-core bash -c '
    hits="$(grep -arnE "from '"'"'(\.{1,2}/[^'"'"']*)'"'"'" --include="*.ts" src | grep -v "\.js'"'"'" || true)"
    [ -z "$hits" ] || { printf "  relative import without .js:\n%s\n" "$hits"; false; }
  '
fi

# ---- server -----------------------------------------------------------------
if [ "$RUN_SERVER" = 1 ]; then
  SB="./node_modules/.bin"
  [ -d "server/node_modules" ] || { echo "server/node_modules missing — run 'pnpm install' in server/" >&2; exit 2; }

  gate "server · typecheck" server "$SB/tsc" --noEmit -p tsconfig.json
  # Same hole as reviewer-core's, same treatment: the wider project is run so a
  # fixture drifting out of a port's shape is visible, but only L06's own test
  # files are allowed to FAIL it. 16 errors across six unrelated files is the
  # documented baseline.
  gate "server · typecheck (L06 test files)" server bash -c '
    out="$(./node_modules/.bin/tsc --noEmit -p tsconfig.eslint.json 2>&1)"
    total="$(printf "%s\n" "$out" | grep -c "error TS" || true)"
    printf "  %s type error(s) across all test files (16 is the known baseline)\n" "$total"
    mine="$(printf "%s\n" "$out" | grep -E "^test/(eval|agents-promote)" || true)"
    [ -z "$mine" ] || { printf "%s\n" "$mine"; false; }
  '
  gate "server · eslint" server "$SB/eslint" .
  # Onion layering: reviewer-core stays pure and the eval module reaches the
  # outside only through the container. `core-stays-pure` is severity: error, which
  # is the other half of the no-model-call claim — the scorer could not import a
  # provider even if its own import list were rewritten.
  gate "server · dependency-cruiser" server \
    "$SB/depcruise" --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
  # The lesson's own hermetic suites, by name.
  gate "server · eval tests" server \
    "$SB/vitest" run --exclude '**/*.it.test.ts' eval agents-promote
  # DDG-WIRE-002 — relative ESM imports carry the `.js` extension. `tsc --noEmit`
  # does not catch a missing one; it fails at runtime. `src/db/schema*` is the one
  # named exception: 54 extensionless imports live there and are loaded by
  # drizzle-kit, not by the running ESM server.
  gate "server · ESM extensions" server bash -c '
    hits="$(grep -arnE "from '"'"'(\.{1,2}/[^'"'"']*)'"'"'" --include="*.ts" src \
      | grep -v "\.js'"'"'" | grep -v "^src/db/schema" || true)"
    [ -z "$hits" ] || { printf "  relative import without .js:\n%s\n" "$hits"; false; }
  '
  # DDG-WIRE-001 — modules are registered STATICALLY in src/modules/index.ts. A
  # module with no entry there mounts nowhere and 404s with no error, and no
  # typechecker can see the absence of a line.
  gate "server · module registered" server bash -c '
    out=""
    for m in $(ls -d src/modules/*/ | xargs -n1 basename | grep -v "^_"); do
      [ -f "src/modules/$m/routes.ts" ] || continue
      grep -q "'"'"'\./$m/routes.js'"'"'" src/modules/index.ts || out="$out UNREGISTERED: $m"
    done
    [ -z "$out" ] || { printf " %s\n" "$out"; false; }
  '

  if [ "$WITH_DB" = 1 ]; then
    # Ordering on a non-unique column returns rows in physical heap order and an
    # update moves one — no fake reproduces that, so this file needs real Postgres.
    gate "server · eval ordering + retention (Postgres)" server \
      "$SB/vitest" run --pool=forks --poolOptions.forks.singleFork eval-order.it
  fi
fi

# ---- client -----------------------------------------------------------------
if [ "$RUN_CLIENT" = 1 ]; then
  CB="./node_modules/.bin"
  [ -d "client/node_modules" ] || { echo "client/node_modules missing — run 'pnpm install' in client/" >&2; exit 2; }

  # `tsc --noEmit`, never `next build`: the build writes the same `client/.next` a
  # running `next dev` owns and corrupts it (`client/INSIGHTS.md`, 2026-08-03).
  gate "client · typecheck" client "$CB/tsc" --noEmit
  gate "client · eslint" client "$CB/eslint" .
  # The Evals tab and the case editor, the two eval screens, the finding action
  # that creates a case, and the hooks all four of them read through.
  gate "client · L06 component tests" client \
    "$CB/vitest" run EvalsTab CaseEditorModal EvalDashboardView AgentEvalView \
    FindingCard FindingsPanel AgentEditor hooks/eval
fi

# ---- summary ----------------------------------------------------------------
printf '\033[1m── verify:l06 ──\033[0m\n'
for line in "${RESULTS[@]}"; do
  case "$line" in
    PASS*) printf '\033[1;32m%s\033[0m\n' "$line" ;;
    *)     printf '\033[1;31m%s\033[0m\n' "$line" ;;
  esac
done

if [ "$FAILED" = 0 ]; then
  printf '\n\033[1;32mL06 verified — %d gates, all green.\033[0m\n' "${#RESULTS[@]}"
else
  printf '\n\033[1;31m%d of %d gates failed.\033[0m\n' "$FAILED" "${#RESULTS[@]}"
fi
exit "$FAILED"
