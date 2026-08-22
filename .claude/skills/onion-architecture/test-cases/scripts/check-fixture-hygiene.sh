#!/usr/bin/env bash
# Deterministic hygiene gate for the onion-architecture test cases.
#
# Costs nothing and needs no model, so it can run on every push while the eval
# runs themselves stay on a schedule. It exists because the single most common way
# to break these fixtures is to describe the planted defect in a comment — which
# hands the reviewer under test the answer and quietly makes the case measure
# nothing. That happened three times while these six cases were being written.
#
# Usage:  scripts/check-fixture-hygiene.sh          (from test-cases/)
# Exit:   0 = clean, 1 = at least one hard failure.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
note() { printf '  %s\n' "$1"; }
bad()  { printf '\033[31mFAIL\033[0m %s\n' "$1"; fail=1; }
ok()   { printf '\033[32m ok \033[0m %s\n' "$1"; }
warn() { printf '\033[33mwarn\033[0m %s\n' "$1"; }

# Vocabulary that gives the planted defect away. A fixture is production code as
# its author would have written it — an author who does not know it is wrong.
GIVEAWAY='layer|ring|onion|boundary|violation|drift|transport|purity|impure|anemic|antipattern|anti-pattern|overkill|over-engineer|planted|TODO|FIXME|HACK|XXX'
# Weaker tells: legitimate in real code, worth a human glance.
SOFT='deliberately|intentionally|on purpose|beware|careful'

echo "== test-case structure =="
shopt -s nullglob
cases=(cases/*/)
[ ${#cases[@]} -eq 0 ] && bad "no cases found under cases/"

for dir in "${cases[@]}"; do
  id=$(basename "$dir")
  for required in case.json expected.md expected-findings.json fixture; do
    [ -e "$dir$required" ] || bad "$id: missing $required"
  done

  if [ -f "$dir/case.json" ]; then
    python3 - "$dir/case.json" "$id" <<'PY' || fail=1
import json, sys
p, cid = sys.argv[1], sys.argv[2]
try:
    c = json.load(open(p))
except Exception as e:
    print(f"FAIL {cid}: case.json is not valid JSON: {e}"); sys.exit(1)
errs = []
if '{{FIXTURE}}' not in c.get('prompt', ''):
    errs.append("prompt does not carry the {{FIXTURE}} placeholder (it would not be portable)")
if not c.get('assertions'):
    errs.append("no assertions")
for a in c.get('assertions', []):
    if not a.get('id') or not a.get('text'):
        errs.append(f"assertion missing id or text: {a}")
if not isinstance(c.get('planted_violations'), int):
    errs.append("planted_violations is not an integer")
if 'expected.md' in c.get('prompt', ''):
    errs.append("the prompt names expected.md — that leaks the answer key")
for e in errs:
    print(f"FAIL {cid}: {e}")
sys.exit(1 if errs else 0)
PY
  fi
done
[ $fail -eq 0 ] && ok "all $(( ${#cases[@]} )) cases have case.json, expected.md, expected-findings.json and fixture/"

echo
echo "== fixture comments (giveaway vocabulary) =="
# -a matters: two files in server/src carry a literal NUL byte and plain grep
# treats such a file as binary and reports NOTHING — a clean result that means
# "never scanned". See server/INSIGHTS.md, 2026-08-19.
hits=$(grep -rnawiE --include='*.ts' -a "$GIVEAWAY" cases/*/fixture 2>/dev/null || true)
if [ -n "$hits" ]; then
  bad "fixture code mentions the vocabulary of the defect it hides:"
  printf '%s\n' "$hits" | sed 's/^/    /'
else
  ok "no giveaway vocabulary in any fixture"
fi

soft=$(grep -rnawiE --include='*.ts' -a "$SOFT" cases/*/fixture 2>/dev/null || true)
if [ -n "$soft" ]; then
  warn "softer tells worth a human glance (not a failure):"
  printf '%s\n' "$soft" | sed 's/^/    /'
fi

echo
echo "== expected-findings.json =="
# The point of this file is that a runner can score recall without a model. It is only
# worth that if every rule it cites really exists and every file it names really is in the
# fixture -- otherwise a case scores 0 for a reason nobody can see.
python3 - <<'PYEF' || fail=1
import json, pathlib, re, sys

rules_md = pathlib.Path('../rules.md')
if not rules_md.exists():
    print("FAIL ../rules.md is missing -- nothing defines the rule IDs"); sys.exit(1)
known = set(re.findall(r'^\| `(OA-[A-Z]+-\d+)`', rules_md.read_text(), re.M))
if not known:
    print("FAIL ../rules.md defines no OA-* IDs"); sys.exit(1)

errs = []
for case_dir in sorted(pathlib.Path('cases').iterdir()):
    if not case_dir.is_dir():
        continue
    cid = case_dir.name
    ef = case_dir / 'expected-findings.json'
    if not ef.exists():
        errs.append(f"{cid}: no expected-findings.json"); continue
    try:
        doc = json.loads(ef.read_text())
    except Exception as e:
        errs.append(f"{cid}: expected-findings.json is not valid JSON: {e}"); continue

    planted = doc.get('planted', [])
    traps = doc.get('traps', [])
    if not planted:
        errs.append(f"{cid}: no planted entries")

    try:
        declared = json.loads((case_dir / 'case.json').read_text()).get('planted_violations')
    except Exception:
        declared = None
    if declared is not None and declared != len(planted):
        errs.append(f"{cid}: case.json says planted_violations={declared} but "
                    f"expected-findings.json lists {len(planted)}")

    for entry in planted + traps:
        eid = entry.get('id', '?')
        rule = entry.get('rule')
        if rule is not None and rule not in known:
            errs.append(f"{cid}/{eid}: cites unknown rule {rule!r} (not in ../rules.md)")
        f = entry.get('file')
        if not f:
            errs.append(f"{cid}/{eid}: no file"); continue
        if not (case_dir / 'fixture' / f).exists():
            errs.append(f"{cid}/{eid}: names {f}, which is not in the fixture tree")
        if entry in planted and not entry.get('match'):
            errs.append(f"{cid}/{eid}: no match tokens -- recall cannot be scored deterministically")

for e in errs:
    print("FAIL " + e)
if not errs:
    print(f"  {len(known)} rule IDs in ../rules.md, every citation resolves, every file exists")
sys.exit(1 if errs else 0)
PYEF
[ $fail -eq 0 ] && ok "expected-findings.json valid in every case"

echo
echo "== answer keys stay out of the fixtures =="
stray=$(find cases/*/fixture -name '*.md' 2>/dev/null || true)
if [ -n "$stray" ]; then
  bad "markdown inside a fixture tree — an agent reviewing the fixture would read it:"
  printf '%s\n' "$stray" | sed 's/^/    /'
else
  ok "no markdown inside any fixture tree"
fi

echo
echo "== fixtures cannot reach a package gate =="
# server/tsconfig.json includes only src/**/*.ts and depcruise cruises
# `src ../reviewer-core/src`, so a fixture is invisible to both as long as it
# lives here. This guards against someone copying a case into a package.
leaked=$(cd ../../../.. 2>/dev/null && find server/src reviewer-core/src -path '*fixture*' -name '*.ts' 2>/dev/null || true)
if [ -n "$leaked" ]; then
  bad "fixture-looking files inside a package's compiled tree:"
  printf '%s\n' "$leaked" | sed 's/^/    /'
else
  ok "nothing fixture-shaped under server/src or reviewer-core/src"
fi

echo
if [ $fail -eq 0 ]; then echo "hygiene: clean"; else echo "hygiene: FAILED"; fi
exit $fail
