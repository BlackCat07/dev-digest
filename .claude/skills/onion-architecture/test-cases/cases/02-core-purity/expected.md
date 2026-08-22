# Answer key — fixture B (`reviewer-core` severity re-weighting)

Planted violations: **3**, all in `reviewer-core/src/review/severity.ts`.

| # | Line(s) | Violation | Rule | Correct shape |
|---|---|---|---|---|
| B1 | 1, 42 | `import { readFile } from 'node:fs/promises'` — filesystem I/O inside the pure core | `core-stays-pure` (error); layer table: Core must never import any I/O | Pass the weight table in as a parameter; the server reads the file and injects it |
| B2 | 38 | `process.env.DEVDIGEST_SEVERITY_WEIGHTS` — environment access inside the pure core | Purity contract: "no `process.env`"; decision framework #5 ("need a config value, a clock or a token? Pass it in as a parameter") | Caller resolves the path/config and passes the resulting weights |
| B3 | 3, 63 | `import { SEVERITY_RANK } from '../../../server/src/modules/reviews/constants.js'` — the core imports **server module** code, i.e. an inward ring depending on an outer one | `core-stays-pure` (error) — its one permitted outward edge is `src/vendor/shared` only | Define the rank in `reviewer-core`, or lift it into the port ring (`@devdigest/shared`) which both packages may read |

## Notes for grading

- `import type { Finding } from '@devdigest/shared'` is **correct** — the port ring is the core's one permitted outward edge. Reporting it is a false positive.
- Making `loadWeights` async is a symptom, not a separate violation; counting it as a 4th finding is acceptable but not required.
- A strong answer also notes the fix collapses `prioritize` back to a synchronous pure function.
- `reviewer-core/CLAUDE.md` states the purity contract directly ("no DB, no GitHub, no filesystem, no `process.env`"), so B1/B2 are reachable **without** the skill. B3 is the discriminating one — it needs the ring model, not just the purity sentence.
