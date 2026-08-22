# Answer key — fixture C (Slack notifications across three rings)

Planted violations: **3**, one per file.

| # | File | Line(s) | Violation | Rule | Correct shape |
|---|---|---|---|---|---|
| C1 | `server/src/adapters/slack/client.ts` | 3, 22-24, 34 | An adapter imports a **feature module's service** (`modules/reviews/service.js`) and calls back into it — an inward ring depending outward | `adapters-are-leaves` (error) | The adapter takes the summary as a parameter; the caller (service/container) reads the review and hands the data over. An adapter is a leaf |
| C2 | `server/src/platform/notifier.ts` | 2-3, 26-27 | `platform/` imports a feature module's `repository`/`helpers` — only `platform/container.ts` may know modules exist | `platform-not-module-aware` (error) | Move `resolveDestination` into the settings (or notifications) module, or have the caller pass the resolved `Destination` in |
| C3 | `server/src/modules/reviews/notify.ts` | 1, 27-28 | A feature module imports the `simple-git` SDK directly instead of going through the `GitClient` port | `modules-no-raw-sdk` (error); decision framework #1 | `container.git.diff(...)` — the `GitClient` port already exposes `diff`; never call an SDK from a module |

## False-positive traps (must NOT be reported as violations)

- `adapters/slack/client.ts` importing `@slack/web-api` — an adapter is exactly where a vendor SDK belongs.
- `adapters/slack/client.ts` importing `@devdigest/shared` types — the port ring is inward of adapters.
- `modules/reviews/notify.ts` importing `../../platform/container.js` and `./constants.js` — both permitted.
- `modules/reviews/notify.ts` importing `../../platform/notifier.js` — `platform/` is cross-cutting and any ring may use it; the defect is in `notifier.ts` (C2), not in this import.

## Notes for grading

A very strong answer also observes that the whole feature is missing the canonical first step — **no port was declared** in `src/vendor/shared/adapters.ts` for notification delivery, so there is nothing for the container to bind. Credit as depth, not as a required 4th finding.
