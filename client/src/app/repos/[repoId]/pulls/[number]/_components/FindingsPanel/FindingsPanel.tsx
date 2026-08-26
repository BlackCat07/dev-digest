/* FindingsPanel — severity filter + hide-low-confidence + j/k navigation +
   FindingCard list, wiring the accept/dismiss action hook (A2) and the
   turn-into-an-eval-case flow (L06).

   Both mutations live HERE rather than in the card, for the same reason: the card
   is a presentational unit several screens render, and a hook inside it would
   demand a query client from every caller. This panel already owns the list, so
   it owns the request each row can start.

   **`Turn into eval case` adds nothing.** It derives a DRAFT — a request that
   writes no row — and opens `EvalCaseDraftModal` over it, where the case can be
   run as many times as the reader likes before `Save` files it. The panel owns
   the draft request and which finding it belongs to; the modal owns the save.
   The distinction matters because the eval set is what an agent's recall and
   precision are computed from, and a set that grew by one row per button press
   would be a set nobody trusts.

   The severity filter lives HERE, not at tab level: it is the header of ONE
   findings list, and this panel is mounted once per review run. So the chip
   counts always describe the cards directly beneath them, and each run filters
   independently. (An earlier version put a chip row above the TIMELINE — that
   had no basis in the design and made several chip rows share one state.) */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, FindingScope, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SeverityFilter } from "../SeverityFilter";
import { ScopeFilter } from "../ScopeFilter";
import { countBySeverity } from "@/lib/severity";
import { countByScope } from "@/lib/scope";
import type { EvalCaseDraft } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { useEvalCaseDraft } from "../../../../../../../lib/hooks/eval";
import { EvalCaseDraftModal } from "../EvalCaseDraftModal";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

/**
 * The refusal code handed down when a request failed without naming a reason — a
 * non-`ApiError` throw, or an `ApiError` whose envelope carried no `code`.
 *
 * Deliberately NOT one of the nine `EvalRefusalReason` members: `FindingCard`
 * looks the code up in its own message map and falls back to a generic sentence
 * for anything it does not recognise, so an unnamed failure still says something.
 * Passing `null` here would be the silent version of the same event, and `""` is
 * falsy and therefore that bug spelled differently.
 */
const UNNAMED_REFUSAL = "unnamed_refusal";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /**
   * The finding a diff badge routed the reader to, when this panel holds it.
   *
   * It arrives with every filter still at its default, which is what makes the
   * landing reliable: `severity` and `scope` are null and `hideLow` is false on
   * mount, so nothing can have filtered the target out from under the navigation.
   */
  targetFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  /**
   * Deriving the draft is THIS panel's mutation, not the card's: the card is
   * rendered by anything that lists findings, and a hook inside it would demand
   * a query client from every one of those callers. The card takes a handler and
   * two display props instead.
   *
   * It POSTs and stores nothing — every refusal the save would answer with
   * arrives here instead, which is what lets a card say "accept or dismiss this
   * first" before a modal opens on a finding that cannot become a case.
   */
  const evalDraft = useEvalCaseDraft();
  const [hideLow, setHideLow] = React.useState(false);
  // ISOLATE filter, local to this run: a level means "only this level", null
  // means no filtering.
  const [severity, setSeverity] = React.useState<Severity | null>(null);
  // The scope filter is a SECOND, orthogonal isolate. It defaults to null on
  // purpose: with nothing set, in-scope, out-of-scope and unlabelled findings
  // all render — this feature annotates, it never drops.
  const [scope, setScope] = React.useState<FindingScope | null>(null);

  /**
   * Which finding the draft request belongs to.
   *
   * Everything the cards display about that request (`opening`, the refusal) is
   * read off the mutation itself on each render. Mirroring `isPending`/`error`
   * into `useState` would put a second copy of one request's status a re-render
   * behind the first, and the card that shows it is picked by comparing against
   * this id — so a stale copy would light up the wrong card.
   */
  const [evalFindingId, setEvalFindingId] = React.useState<string | null>(null);

  /**
   * The draft currently being edited, or none.
   *
   * Held here rather than read off the mutation, and the difference is the whole
   * feature: `evalDraft.data` is replaced the moment another draft is derived,
   * while a modal must survive until it is saved or dismissed. It is also the
   * only thing that says the modal is OPEN — deriving a second draft while one
   * is open is not possible, because the modal covers the list.
   */
  const [openDraft, setOpenDraft] = React.useState<EvalCaseDraft | null>(null);

  /**
   * The findings that reached the eval set, by id.
   *
   * A list rather than a flag off the save mutation, because the save now lives
   * in the modal and the modal unmounts on success: the card that asked has to
   * keep saying `Added to the eval set` after the thing that knew about it is
   * gone. Several findings can be added in one sitting, so this is a set and not
   * a single id.
   */
  const [savedFindingIds, setSavedFindingIds] = React.useState<string[]>([]);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const scopeCounts = React.useMemo(() => countByScope(findings), [findings]);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severity, scope),
    [findings, hideLow, severity, scope],
  );

  // The j/k cursor starts on the TARGETED finding when there is one, so a card
  // reached from the diff arrives already outlined — the same highlight j/k gives —
  // and the next `j` continues from where the reader actually is. Lazily computed,
  // so a later filter change cannot recompute it against a stale target.
  const [focusIdx, setFocusIdx] = React.useState(() => {
    const at = targetFindingId ? shown.findIndex((f) => f.id === targetFindingId) : -1;
    return at < 0 ? 0 : at;
  });

  // Filtering shrinks `shown`, but focusIdx isn't otherwise reset — leaving the
  // j/k cursor pointing past the end, so no card looks focused. The first run is
  // skipped: on mount the cursor is already where it belongs (0, or the targeted
  // finding above), and resetting it there would undo the landing.
  const filtersTouched = React.useRef(false);
  React.useEffect(() => {
    if (!filtersTouched.current) {
      filtersTouched.current = true;
      return;
    }
    setFocusIdx(0);
  }, [severity, scope, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  /**
   * What the card that asked should say while its draft is being derived.
   *
   * One request is in flight at a time and `evalFindingId` says whose it is, so
   * this value is computed once and handed only to THAT card below. `added` is
   * per finding and comes from `savedFindingIds`, not from here: a save that
   * happened inside a modal which has since unmounted has no mutation left to
   * read.
   *
   * The state union is inferred rather than imported: `EvalCaseState` is not on
   * `FindingCard`'s barrel, and reaching past a unit's public API for a type is a
   * worse trade than letting three literals speak for themselves.
   */
  const evalCaseState = evalDraft.isPending ? "opening" : "idle";
  /* The server's `code`, not a sentence: the wording lives in the `prReview`
     catalogue the card already reads, so there is exactly one place a refusal is
     phrased. An error that names no code still says something — see
     `UNNAMED_REFUSAL`. */
  const evalRefusalCode = evalDraft.error
    ? ((evalDraft.error instanceof ApiError ? evalDraft.error.code : null) ?? UNNAMED_REFUSAL)
    : null;

  return (
    <div>
      <div style={s.toolbar}>
        {/* Nothing to filter in an empty run — show just its empty state. */}
        {findings.length > 0 && (
          <>
            <SeverityFilter counts={counts} active={severity} onChange={setSeverity} />
            <div style={s.divider} />
            <ScopeFilter counts={scopeCounts} active={scope} onChange={setScope} />
          </>
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              // The targeted card opens too: the reader clicked a severity badge to
              // read WHY, and an arrival on a collapsed title answers nothing.
              defaultExpanded={i === 0 || f.id === targetFindingId}
              targeted={f.id === targetFindingId}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              /* One request per press, carrying the finding id and nothing else:
                 the expectation (`must_find` / `must_not_flag`) is derived
                 server-side from the decision this finding already carries. It
                 DERIVES; the modal it opens is what can save. */
              onTurnIntoEvalCase={() => {
                setEvalFindingId(f.id);
                evalDraft.mutate(f.id, { onSuccess: (d) => setOpenDraft(d) });
              }}
              evalCaseState={
                savedFindingIds.includes(f.id)
                  ? "added"
                  : f.id === evalFindingId
                    ? evalCaseState
                    : "idle"
              }
              /* The refusal lands on the card that asked, and on no other. It
                 disables neither `Accept` nor `Dismiss` — it is about the eval
                 case, not about the finding. */
              evalRefusalCode={f.id === evalFindingId ? evalRefusalCode : null}
            />
          ))
        )}
      </div>

      {/* Keyed on the finding, so opening a different one remounts the editor
          rather than leaving the previous draft's edits in its fields. */}
      {openDraft && evalFindingId && (
        <EvalCaseDraftModal
          key={evalFindingId}
          draft={openDraft}
          onClose={() => setOpenDraft(null)}
          onSaved={() => {
            setSavedFindingIds((prev) =>
              prev.includes(evalFindingId) ? prev : [...prev, evalFindingId],
            );
            setOpenDraft(null);
          }}
        />
      )}
    </div>
  );
}
