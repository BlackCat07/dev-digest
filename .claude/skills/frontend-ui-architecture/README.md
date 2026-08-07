# frontend-ui-architecture — sources and rationale

Why this skill says what it says, and where each rule came from. `SKILL.md` states decisions;
this file records the evidence and the disagreements behind them.

## Contents

- Version
- Scope and why this skill exists separately
- How the rules were chosen
- Contested points and the side this skill picked
- Sources — React and general structure
- Sources — Next.js architecture
- Repository sources

## Version

**1.0.0**

| Version | Change |
|---|---|
| 1.0.0 | First release. Six laws, placement/decomposition/logic/state/boundaries references, two Next.js references, DevDigest mapping. Built from the source review below (2026-08). |

Bump the minor version when a rule changes or a reference file is added; bump the patch
version for wording and examples. Record every bump in the table with what changed, and update
the `version` field in `SKILL.md` frontmatter to match.

## Scope and why this skill exists separately

Two skills in this repository already cover neighbouring ground:

- `react-best-practices` — rules **inside** a component: purity, derived state, effects,
  memoisation, keys, conditional rendering, accessibility. Its "Code Organization" section is
  six lines; this skill is that section, expanded.
- `next-best-practices` — **API-level** rules: which special files exist, what is legal at an
  RSC boundary, async `params`, metadata, hydration errors, route handlers.

Neither answers *where a file goes*, *when to split it*, or *which layer owns a piece of
logic*. Those questions are this skill's only subject, and it deliberately does not restate
rules from the other two.

## How the rules were chosen

The primary sources below were read in full; secondary ones were sampled for consensus. Where
they agreed, the agreement became a rule. Where they conflicted — and they conflict on almost
every practical question — the skill picks one side and says so, because a codebase needs one
answer.

Three decisions shaped the rest:

1. **Colocation is the default, promotion is the exception.** The "second consumer" rule
   turns the abstract advice ("things that change together live together") into something you
   can apply without judgment.
2. **Splitting is symptom-driven.** Line counts and prop counts became smells rather than
   triggers, following the strongest argument in the sources against premature abstraction.
3. **Boundary placement and data-access choice are structural**, not stylistic — which is why
   the Next.js half of the skill is about *where the directive and the data layer go*, not
   about how they work.

## Contested points and the side this skill picked

| Question | Positions found | This skill |
|---|---|---|
| Organise by feature or by function? | feature-based (bulletproof-react, FSD, Wieruch) vs by-function, arguing feature boundaries drift from product reality (Comeau) | a four-rung ladder: flat → route/feature colocated → feature modules with public APIs → layered/monorepo. Climb on pain, not in anticipation |
| Component size limits | ~200 lines / 5–7 props (this repo's `react-best-practices`) vs no limits at all, split on real problems only (Dodds), vs "fits on a screen" (Developer Way) | seven named symptoms; the numbers are smells that prompt a look, never triggers |
| Barrel files | never, they break tree-shaking (bulletproof-react) vs mandatory public API per slice (FSD) vs cost is negligible (Comeau) | the disagreement is about cardinality: one unit → one barrel, required; many modules → no barrel, never `export *` |
| `helpers` vs `utils` vs `lib` | mutually contradictory definitions across sources | fixed one table of definitions, banned a `utils` bucket, and stated that the naming is arbitrary but must be consistent |
| Types: central folder or colocated? | dedicated `types/` with barrels vs types next to the code that uses them | props in the component file, domain types with the feature, one module for backend contracts, no global bucket |
| File naming | PascalCase component files (React community) vs all-kebab-case (Wieruch, Comeau, some ADRs) | PascalCase for components, kebab-case for everything else — matching this repo |
| A separate application/use-case layer | clean-architecture layering with DI vs "overkill for simple requests" (the same author) | introduce only when two of four conditions hold; otherwise a hook calling the transport module is the right amount of structure |
| Container/presentational | classic pattern vs retracted by its author after hooks | the boundary is the hook, not a wrapper component |
| How deep does `'use client'` go? | "push to the leaves" (framework docs and most community sources) | two valid positions chosen by data ownership; leaves when the server owns the data, the view when an external API plus a query library do |
| `app/` as routing or as architecture | colocate inside route segments (framework docs, colocation template) vs `app/` for routing only with a product tree in `src/` (FSD) | both are valid shapes; pick one per project and apply it wholesale. Start colocated |

## Sources — React and general structure

**Read in full.**

- [bulletproof-react — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature folders, the unidirectional rule, and the `import/no-restricted-paths` zones in `boundaries.md`.
- [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview) — layers/slices/segments, "import only from layers strictly below", public API per slice.
- [React docs (legacy) — File Structure FAQ](https://legacy.reactjs.org/docs/faq-structure.html) — "don't spend more than five minutes", nesting depth, no framework opinion.
- [react.dev — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — the `use` naming rule, "stateful logic, not state", concrete use cases over lifecycle wrappers, hook purity, "some duplication is fine".
- [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/) — the staged progression behind the four-rung ladder; naming conventions.
- [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) — the principle, the zombie-code argument, and the explicit exception for e2e tests.
- [Kent C. Dodds — When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — the symptom list and the case against line limits.
- [Josh Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) — component-per-directory, the helpers/utils distinction, the counterargument to feature folders and to the anti-barrel position.
- [Developer Way — Components composition: how to get it right](https://www.developerway.com/posts/components-composition-how-to-get-it-right) — compose-vs-configure, "don't stop halfway", composition as a re-render boundary.
- [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) — bulletproof structure as a default; file-internal ordering.
- [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) — the argument against splitting by type; FSD in practice.
- [dangz.dev — How to structure a React app](https://dangz.dev/blog/how-to-structure-a-react-app-in-2026) — "keep shared lean", per-feature api modules, the warning about hexagonal over-engineering.
- [jkettmann — Path to a cleaner React architecture: business logic separation](https://dev.to/jkettmann/path-to-a-cleaner-react-architecture-part-6-business-logic-separation-221g) — the use-case layer, DI through a hook, and the author's own list of when it is overkill. (Original at `profy.dev`, read via this mirror.)

**Consulted for consensus.**

- Structure overviews: [Tania Rascia](https://www.taniarascia.com/react-architecture-directory-structure/) · [Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/) · [DZone](https://dzone.com/articles/production-grade-react-project-structure) · [7 ways to organize a React app](https://rahuulmiishra.medium.com/react-folder-structure-7-ways-to-organize-a-react-app-and-exactly-when-each-one-breaks-ccb10dba68c2) · [reboot.studio](https://reboot.studio/blog/folder-structures-to-organize-react-project) · [codecentric on FSD](https://www.codecentric.de/en/knowledge-hub/blog/feature-sliced-design-and-good-frontend-architecture)
- Colocation and locality: [State colocation](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) · [Locality of behaviour](https://mtsknn.fi/blog/locality-of-behavior-and-co-location/)
- Decomposition: [Techniques for decomposing React components](https://medium.com/dailyjs/techniques-for-decomposing-react-components-e8a1081ef5da) · [patterns.dev — container/presentational](https://www.patterns.dev/react/presentational-container-pattern/) · [Why to stop using container/presentational](https://medium.com/nmc-techblog/why-you-should-stop-using-the-container-presentational-pattern-in-redux-29b112406128) · [Not all components are created equal](https://nearform.com/digital-community/react-components/)
- Logic placement: [Separation of concerns with React hooks](https://felixgerschau.substack.com/p/separation-of-concerns-with-react) · [Where to write business logic](https://medium.com/@rivoltafilippo/where-to-write-business-logic-in-react-separation-of-concers-for-frontend-interviews-59283b5d4b27) · [Decoupling business logic with custom hooks](https://www.emoosavi.com/blog/decoupling-business-logic-from-ui-with-custom-react-hooks) · [Services pattern](https://unwiredlearning.com/blog/react-services-pattern) · [Feature-based architecture that scales](https://dev.to/matkarimov099/feature-based-react-architecture-that-actually-scales-fe4)
- Folder vocabulary: [Libs vs utils vs services](https://indie-starter.dev/blog/lib-vs-utils-vs-services-folders-simple-explanation-for-developers) · [Are utils a code smell?](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054)
- Constants: [Constants layer in JavaScript](https://semaphore.io/blog/constants-layer-javascript) · [Avoid hardcoded values in React](https://javascript.plainenglish.io/avoid-hardcoded-values-in-react-a-guide-to-cleaner-more-maintainable-code-5a052a876b77)
- Types: [Where your types live matters](https://blog.serghei.pl/posts/where-your-types-live-matters/) · [How to organize types in a React project](https://www.wisp.blog/blog/how-to-organize-types-in-a-react-project) · [How should I organize my types](https://www.wisp.blog/blog/how-should-i-organize-my-types-as-a-react-developer)
- Naming: [Naming conventions in React](https://www.sufle.io/blog/naming-conventions-in-react) · [Unified naming strategy ADR](https://docs.devland.is/technical-overview/adr/0009-naming-files-and-directories) · [JS file naming conventions](https://dev.to/codewithluke/javascript-file-naming-conventions-1fn7) · [Opinionated guide to folder structure and file naming](https://dev.to/farazamiruddin/an-opinionated-guide-to-react-folder-structure-file-naming-1l7i)
- State layers: [TanStack Query — does this replace client state?](https://tanstack.com/query/v5/docs/framework/react/guides/does-this-replace-client-state) · [Server vs client state](https://nextfuture.io.vn/blog/react-server-state-vs-client-state-guide) · [State management: which tool when](https://ncctcr.com/blog/react-state-management-2026) · [Zustand — slices pattern](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern) · [One store or many?](https://github.com/pmndrs/zustand/discussions/2486)
- Barrels: [Burn the barrel](https://uglow.medium.com/burn-the-barrel-c282578f21b6) · [webpack discussion on barrels and tree-shaking](https://github.com/webpack/webpack/discussions/16863) · [Barrel files and bundle size](https://www.catchmetrics.io/blog/nextjs-bundle-size-improvements-optimize-your-performance) · [The index.ts dilemma](https://krishnavadlamudi44.medium.com/the-index-ts-dilemma-balancing-convenience-and-performance-in-typescript-projects-85e9dd4fc18f)
- Enforcement: [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) · [dependency-cruiser for frontend architecture](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) · [steiger](https://github.com/feature-sliced/steiger) · [eslint-plugin-fsd-lint](https://github.com/effozen/eslint-plugin-fsd-lint) · [FSD ESLint config guide](https://feature-sliced.design/blog/mastering-eslint-config) · [JS Boundaries](https://www.jsboundaries.dev/docs/overview/) · [Architectural linting exercise](https://stevekinney.com/courses/enterprise-ui/architectural-linting-exercise)
- Test placement: [The case for colocating tests](https://medium.com/@Connorelsea/the-case-for-colocating-tests-in-react-cef6ea7b4a1a) · [Co-locate your unit tests](https://www.yockyard.com/post/co-locate-unit-tests/) · [GitLab UI: colocate tests and components](https://gitlab.com/gitlab-org/gitlab-ui/-/issues/417)

## Sources — Next.js architecture

**Read in full.**

- [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) — private folders, route groups, colocation safety, and the three documented strategies behind the two shapes in `nextjs-structure.md`.
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — the directive as a module-graph boundary, interleaving via `children`, provider depth, environment poisoning.
- [Next.js — How to think about data security](https://nextjs.org/docs/app/guides/data-security) — the three data-access approaches and the instruction not to mix them; data layer, narrow props, re-authorising inside every mutation handler; the audit checklist.
- [Next.js — How to build single-page applications](https://nextjs.org/docs/app/guides/single-page-applications) — the external-API shape: seeding a query cache from the server, scoping that seed to the segment that owns the data, and the query key as a contract derived in one place.
- [Feature-Sliced Design — the Next.js App Router guide](https://feature-sliced.design/blog/nextjs-app-router-guide) — the routing-folder vs product-tree separation, thin route entries, and the "no global service gravity" warning.
- [freeCodeCamp — Reusable architecture for large Next.js applications](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/) — feature modules with public APIs, and the package-vs-local rule for shared code.
- [Next.js Colocation Template](https://next-colocation-template.vercel.app/) — an independent derivation of the same promotion rule: segment-private, then parent segment, then top level.

**Consulted for consensus.**

- Boundary depth: [Drawing the right boundary](https://www.iamraghuveer.com/posts/nextjs-server-vs-client-components/) · [App Router patterns: what to use and avoid](https://pristren.com/blog/nextjs-app-router-patterns-2026/) · [Server-first, client islands](https://www.yogijs.tech/blog/nextjs-project-architecture-app-router)
- Structure: [App Router architecture guide](https://amitdevx.tech/blogs/nextjs-15-app-router-architecture-guide) · [App Router best practices for production](https://ztabs.co/blog/nextjs-app-router-best-practices) · [Enterprise patterns with the App Router](https://medium.com/@vasanthancomrads/enterprise-patterns-with-the-next-js-app-router-ff4ca0ef04c4) · [Folder structure best practices](https://www.dharmsy.com/blog/nextjs-16-app-router-folder-structure) · [Full-stack folder structure](https://www.groovyweb.co/blog/nextjs-project-structure-full-stack) · [Route visibility and colocation](https://dev.to/bridget_amana/understanding-route-visibility-and-colocation-in-nextjs-app-router-2bni)
- Mutations and data layer: [Server actions folder structure](https://github.com/orgs/community/discussions/184740) · [Server actions in production](https://www.digitalapplied.com/blog/nextjs-server-actions-production-patterns-2026-guide) · [Server actions security](https://makerkit.dev/blog/tutorials/secure-nextjs-server-actions) · [Type-safe server actions with Zod](https://yournextstore.com/blog/typesafe-server-actions-zod-nextjs) · [Forms with server actions](https://www.robinwieruch.de/next-forms/) · [Structuring a data access layer](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866) · [Understanding the data access layer](https://aysh.me/blogs/data-access-layer-nextjs) · [Backend for frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)

## Repository sources

The `devdigest-map.md` reference is derived from, and subordinate to, these files:

- `client/CLAUDE.md` — the colocated feature unit, thin routes, the styling mechanism, the
  no-`fetch` rule, the client boundary at the view.
- `client/docs/feature-unit.md` — Rule 1 (folder depth follows who renders it), the
  shared-unit styling corollary, the list-column invariant, the new-unit checklist.
- `client/INSIGHTS.md` — the file-grounded record: type-only imports of the shared contract,
  the duplicated path aliases, and the placement entries the promotion rule came from.
- `.claude/skills/README.md` — the catalogue this skill is listed in, and the rule that
  locally authored skills do not belong in `skills-lock.json`.

Skill-authoring conventions follow [Anthropic's skill authoring best
practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
third-person description with explicit triggers, `SKILL.md` under 500 lines, reference files
one level deep with a table of contents, no time-sensitive statements, one recommended
approach per question.
