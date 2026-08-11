/* RiskAreas — the RISK AREAS chip row inside the intent card (L03).

   PRESENTATIONAL and prop-driven, like `IntentCard` itself: no data hook, so it
   mounts with `NextIntlClientProvider` alone. Nested under `IntentCard/` because
   that card is its only renderer — a sibling folder would advertise a second
   consumer that does not exist.

   The chips are BUTTONS, not decoration. Each risk carries an explanation and the
   files it concerns, and that payload is why the block earns its space — a row of
   untappable labels would say "something about auth" and stop there. One panel is
   open at a time and clicking the open chip closes it, so the block never grows
   taller than one risk's worth of prose.

   Two deliberate omissions, both about not dressing model output up as more than
   it is:

     - The explanation renders as PLAIN TEXT, not through the `Markdown`
       primitive. That primitive maps `a`, so a markdown link in model output —
       text derived from an author-controlled PR description — would become a
       live anchor pointing anywhere. Two sentences gain nothing from GFM.
     - File references render as mono TEXT, not `MonoLink`. Without an `href`
       that primitive renders a `<button>`, and a button that does nothing is
       worse than a label. The Files-changed deep link is not wired yet. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { riskIcon, riskSeverityColor } from "@/lib/risk";
import { s } from "./styles";

export interface RiskAreasProps {
  risks: Risk[];
}

export function RiskAreas({ risks }: RiskAreasProps) {
  // Index of the open chip, or null. Index rather than an id: `Risk` has none,
  // and this is immutable server data that is never reordered while mounted.
  const [open, setOpen] = React.useState<number | null>(null);

  // Nothing to say is not an empty state. A change with no notable risk should
  // look like one, so the whole block — label included, which is why the guard
  // lives here and not in the parent — renders nothing. We also never claim "no
  // risks found": we did not verify that.
  if (risks.length === 0) return null;

  const active = open !== null ? risks[open] : undefined;

  return (
    <div>
      <div style={s.row}>
        {risks.map((risk, i) => {
          // `riskIcon` is total by construction: `Risk.kind` is an open string in
          // the contract, so an unknown kind must not become `Icon[undefined]`.
          const I = Icon[riskIcon(risk.kind)];
          const color = riskSeverityColor(risk.severity);
          const isOpen = open === i;
          return (
            <button
              key={i}
              type="button"
              style={s.chip(isOpen, color)}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <I size={13} style={{ color, flexShrink: 0 }} />
              <span>{risk.title}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div style={s.panel}>
          <div>{active.explanation}</div>
          {active.file_refs.length > 0 && (
            <div style={s.refs}>
              {active.file_refs.map((ref, i) => (
                <span key={i} style={s.ref}>
                  {ref}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
