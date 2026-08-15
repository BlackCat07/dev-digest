#!/usr/bin/env bash
#
# DevDigest MCP server — stdio launcher used by the repo's .mcp.json.
#
#   bash scripts/mcp.sh          # started by the MCP client, not by hand
#
# stdout is the JSON-RPC channel: nothing but protocol frames may be written to
# it. Every message this script emits goes to stderr, and there is no `echo` on
# the success path at all.
#
# It resolves its own repo root, so the client's cwd does not matter.
#
# It installs NOTHING. An install on every MCP start is unacceptable, and this
# repo has twice recorded an implicit install wrecking the working tree
# (server/INSIGHTS.md, 2026-08-02 and 2026-08-04). Missing dependencies are
# reported once, on stderr, and the launcher exits non-zero.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT/mcp-server/node_modules" ]; then
  echo "devdigest-mcp: dependencies are missing — run 'npm ci' in $ROOT/mcp-server, then restart this MCP server (this launcher installs nothing)" >&2
  exit 1
fi

cd "$ROOT/mcp-server"

exec ./node_modules/.bin/tsx src/index.ts
