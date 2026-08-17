# mcp-server specs

What each behaviour of the MCP server must do, from an MCP client's side: which tools exist,
what arguments they take, and exactly what comes back — including every empty and failed case.

Format, naming and required sections: [`../../docs/specs-convention.md`](../../docs/specs-convention.md).

## Specs

| Spec | Covers |
|---|---|
| [`devdigest-mcp.md`](devdigest-mcp.md) | The five tools and their arguments, the projection every response is, the three `run_agent_on_pr` statuses, the two addressing paths of `get_findings`, the two distinct conventions empty cases, and the blast-radius stub's honesty properties. |

## Scope of an mcp-server spec

The observable tool contract. Three things stay out:

- **Why the design is shaped this way** — the wait loop, the caches, the `zod` pin, the
  stdout guard — that is [`../CLAUDE.md`](../CLAUDE.md) and the file headers under
  [`../src/`](../src).
- **What the API itself must do.** This package adds no endpoint; the server-side behaviour it
  reads is `../../server/specs/`.
- **How it is tested and gated** — that is [`../../TESTING.md`](../../TESTING.md).

A spec here describes what a **tool answers**, not the JSON the API returned: every response is
an explicit projection, so the fields that are deliberately absent are part of the contract and
belong in the spec.
