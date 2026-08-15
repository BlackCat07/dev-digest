# PR id chip

A reader of a pull request can see and copy that PR's row uuid without querying the API.

## Behaviour

1. The PR detail header's meta row carries an `id` chip after the status badge: the label
   `id`, the pull request's uuid in the mono face, and an icon button that copies it.
2. The uuid is rendered in full, never truncated or elided — the value is meant to be read
   off the screen as well as copied.
3. Pressing the button writes the uuid to the clipboard and the icon changes to a check for
   1.2 s, then reverts. The chip's title and accessible name change with it
   (`Copy pull request id` → `Copied`).
4. Selecting the uuid with the pointer selects the whole value and nothing around it, so a
   double-click is an equivalent fallback where the clipboard is unavailable.
5. The chip is absent — not empty, not a placeholder — while the pull request's id is not
   yet known.

## Data

The uuid already on the screen's own data: `prId`, the `id` of the `PrDetail` the PR detail
view loads. No additional request, no additional field.

## States

- **Id not yet known** (first paint, or the detail request still in flight): the chip does
  not render. The rest of the meta row is unaffected.
- **No clipboard** (jsdom, a non-secure origin): the write is skipped without throwing; the
  copied flash still runs, and statement 4 is the working path.
- **Error / empty / loading** of the PR itself: owned by the detail view, which does not
  render the header at all in those cases.

## Non-goals

- **Not a change of address.** The route stays `/repos/:repoId/pulls/:number`; the uuid is
  displayed, not put in the URL. The GitHub-shaped pair remains how a PR is named.
- **Not a general id-copying affordance.** Repository, agent and run ids are reachable
  elsewhere (the URL, `devdigest_list_agents`, a run's own answer) and get no chip here.

## Implementation

- `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx` —
  `PrIdChip`, local to the header the way `ConventionCard`'s `CopySnippet` is local to it.
- `src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/styles.ts` — `idChip`,
  `idLabel`, `idValue`, `idCopy`.

## Related

- `../../mcp-server/specs/devdigest-mcp.md` statement 15a — the `pr_id` argument this chip
  exists to supply. The tools' descriptions tell a caller the uuid is "as shown in a
  DevDigest studio URL"; it is not in the URL, and this chip is where it actually is.

## History

`2026-08-15` — Added. The MCP tools accept `pr_id`, and the studio offered no way to obtain
one: the URL carries the repository's uuid and the PR's *number*, so a caller holding the
tool description had nowhere to copy from.
