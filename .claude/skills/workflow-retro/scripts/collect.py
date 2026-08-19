#!/usr/bin/env python3
"""Collect the measurable facts of one session's multi-agent run.

Reads the session transcript and every subagent transcript it dispatched, and
prints a markdown facts block. It MEASURES and never interprets: no advice, no
severity, no "should". The interpretation is the model's job in SKILL.md, and
keeping the two apart is the point — a number the model estimated is a number
that will drift, and this repo has already paid for that once
(`server/INSIGHTS.md`, 2026-08-11: a fixture that reports its own size lies).

Stdlib only. Reads nothing but transcripts; writes nothing anywhere.

Usage:
  collect.py                     # newest session of the current project
  collect.py --session <id>      # a specific session id (the .jsonl basename)
  collect.py --transcript <path> # an explicit transcript file
  collect.py --top 15            # widen the per-table cut-off (default 8)
  collect.py --json              # machine-readable instead of markdown
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

WRITE_TOOLS = {"Write", "Edit", "NotebookEdit"}
READ_TOOLS = {"Read", "NotebookRead"}
PATH_IN_CMD = re.compile(r"[\w./@-]+\.(?:md|ts|tsx|js|jsx|json|sql|css|sh|py|ya?ml)\b")


# ----------------------------------------------------------------- locating

def project_dir(cwd: Path) -> Path:
    """Claude Code slugifies the cwd: every non-alphanumeric run becomes '-'."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(cwd))
    return Path.home() / ".claude" / "projects" / slug


def newest_transcript(pdir: Path) -> Path | None:
    files = sorted(pdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


# ------------------------------------------------------------------ reading

def lines(path: Path):
    """Yield parsed JSON objects, skipping anything unparseable.

    A transcript is appended to while it is being read, so a truncated last
    line is normal and is not an error worth reporting.
    """
    try:
        handle = path.open(encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue


def norm_path(raw: str, root: Path) -> str | None:
    """Collapse the spellings of one file into a single key, or drop the token.

    A path is harvested from three shapes — a Read `file_path` (absolute), a
    repo-relative path typed into a Bash command, and a fragment of a shell
    variable (`$f/INSIGHTS.md`). Keying on the raw string splits one file across
    three rows and makes the duplication table undercount, which is the one
    number this section exists to report. So a token counts only when it
    resolves to a file that exists, and it is then keyed repo-relative.
    A path deleted since the run drops out — honest, and rare.
    """
    if not raw or "$" in raw or raw.startswith("-"):
        return None
    candidate = Path(raw)
    for probe in ((candidate,) if candidate.is_absolute() else (root / candidate, candidate)):
        try:
            if probe.is_file():
                resolved = probe.resolve()
                try:
                    return str(resolved.relative_to(root.resolve()))
                except ValueError:
                    return str(resolved)
        except OSError:
            continue
    return None


def blocks(message) -> list:
    """Content is a list of blocks, a bare string, or absent. Guard all three."""
    if not isinstance(message, dict):
        return []
    content = message.get("content")
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


def ts(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def text_of(value, limit: int = 240) -> str:
    if isinstance(value, str):
        out = value
    elif isinstance(value, list):
        out = " ".join(
            b.get("text", "") for b in value if isinstance(b, dict) and b.get("type") == "text"
        ) or json.dumps(value)[:limit * 2]
    else:
        out = json.dumps(value)[:limit * 2] if value is not None else ""
    return " ".join(out.split())[:limit]


# ------------------------------------------------------------------ scanning

class Participant:
    """One context that made model calls: the main loop, or one subagent."""

    def __init__(self, key: str, label: str):
        self.key = key
        self.label = label
        self.models: Counter = Counter()
        self.efforts: Counter = Counter()
        self.assistant_turns = 0
        self.input = 0
        self.output = 0
        self.thinking = 0
        self.cache_create = 0
        self.cache_read = 0
        self.tools: Counter = Counter()
        self.reads: Counter = Counter()
        self.writes: Counter = Counter()
        self.commands: Counter = Counter()
        self.errors: list[tuple[str, str]] = []
        self.empty_bash = 0
        self.first: datetime | None = None
        self.last: datetime | None = None
        self.dispatches: list[dict] = []
        self.parent: str | None = None

    # -- derived ---------------------------------------------------------
    @property
    def uncached(self) -> int:
        """Tokens that were NOT served from cache — the expensive side."""
        return self.input + self.cache_create + self.output

    @property
    def wall_s(self) -> float:
        if not self.first or not self.last:
            return 0.0
        return (self.last - self.first).total_seconds()

    def note_time(self, when: datetime | None) -> None:
        if not when:
            return
        self.first = when if self.first is None or when < self.first else self.first
        self.last = when if self.last is None or when > self.last else self.last


def scan(path: Path, part: Participant, tool_names: dict[str, str], root: Path) -> None:
    """Fold one transcript file into `part`. `tool_names` maps id → tool name."""
    for obj in lines(path):
        when = ts(obj.get("timestamp"))
        part.note_time(when)
        message = obj.get("message")

        if obj.get("type") == "assistant":
            part.assistant_turns += 1
            if isinstance(message, dict):
                part.models[message.get("model") or "unknown"] += 1
                usage = message.get("usage")
                if isinstance(usage, dict):
                    part.input += usage.get("input_tokens") or 0
                    part.output += usage.get("output_tokens") or 0
                    part.cache_create += usage.get("cache_creation_input_tokens") or 0
                    part.cache_read += usage.get("cache_read_input_tokens") or 0
                    details = usage.get("output_tokens_details")
                    if isinstance(details, dict):
                        part.thinking += details.get("thinking_tokens") or 0
            if obj.get("effort"):
                part.efforts[obj["effort"]] += 1

            for block in blocks(message):
                if block.get("type") != "tool_use":
                    continue
                name = block.get("name") or "unknown"
                args = block.get("input") if isinstance(block.get("input"), dict) else {}
                part.tools[name] += 1
                if block.get("id"):
                    tool_names[block["id"]] = name
                if name in READ_TOOLS and args.get("file_path"):
                    key = norm_path(str(args["file_path"]), root)
                    if key:
                        part.reads[key] += 1
                elif name in WRITE_TOOLS and args.get("file_path"):
                    key = norm_path(str(args["file_path"]), root)
                    if key:
                        part.writes[key] += 1
                elif name == "Bash":
                    cmd = " ".join(str(args.get("command", "")).split())
                    if cmd:
                        part.commands[cmd] += 1
                    for hit in PATH_IN_CMD.findall(str(args.get("command", ""))):
                        key = norm_path(hit, root)
                        if key:
                            part.reads[key] += 1
                elif name in ("Agent", "Task"):
                    part.dispatches.append(
                        {
                            "at": obj.get("timestamp"),
                            "tool_id": block.get("id"),
                            "subagent_type": args.get("subagent_type") or "general-purpose",
                            "description": args.get("description") or "",
                            "model_arg": args.get("model"),
                            "prompt_chars": len(str(args.get("prompt") or "")),
                            "isolation": args.get("isolation"),
                        }
                    )

        # Tool results ride on user-role lines; errors are the friction signal.
        for block in blocks(message):
            if block.get("type") != "tool_result":
                continue
            tool = tool_names.get(block.get("tool_use_id") or "", "?")
            body = text_of(block.get("content"))
            if block.get("is_error"):
                part.errors.append((tool, body))
            elif tool == "Bash" and not body:
                part.empty_bash += 1

        result = obj.get("toolUseResult")
        if isinstance(result, dict):
            if result.get("agentId"):
                for dispatch in part.dispatches:
                    if not dispatch.get("agent_id") and dispatch["description"] == (
                        result.get("description") or dispatch["description"]
                    ):
                        dispatch["agent_id"] = result["agentId"]
                        dispatch["resolved_model"] = result.get("resolvedModel")
                        break
            stdout = result.get("stdout")
            if isinstance(stdout, str) and not stdout.strip() and "stderr" in result:
                part.empty_bash += 1


# ------------------------------------------------------------------ reporting

def fmt_int(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def fmt_dur(seconds: float) -> str:
    if seconds <= 0:
        return "—"
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}m{secs:02d}s" if minutes else f"{secs}s"


def render(parts: list[Participant], transcript: Path, top: int) -> str:
    main = parts[0]
    out: list[str] = []
    add = out.append

    starts = [p.first for p in parts if p.first]
    ends = [p.last for p in parts if p.last]
    span = (max(ends) - min(starts)).total_seconds() if starts and ends else 0.0

    add("# Run facts")
    add("")
    add(f"- transcript: `{transcript}`")
    add(f"- session: `{transcript.stem}`")
    add(f"- span: {fmt_dur(span)} wall-clock, {len(parts) - 1} subagent(s) dispatched")
    add(f"- agent wall-clock summed: {fmt_dur(sum(p.wall_s for p in parts[1:]))}")
    add("")

    add("## Ledger")
    add("")
    add("`uncached` = input + cache-creation + output — the side that is paid for in full.")
    add("`cache read` is the cheap column and is reported separately on purpose: summing")
    add("the two produces a headline number that is wrong by an order of magnitude.")
    add("")
    add("| participant | model | turns | uncached | output | thinking | cache create | cache read | tools | wall |")
    add("|---|---|---|---|---|---|---|---|---|---|")
    for p in parts:
        model = ", ".join(sorted(p.models)) or "—"
        add(
            f"| {p.label} | {model} | {p.assistant_turns} | {fmt_int(p.uncached)} | "
            f"{fmt_int(p.output)} | {fmt_int(p.thinking)} | {fmt_int(p.cache_create)} | "
            f"{fmt_int(p.cache_read)} | {sum(p.tools.values())} | {fmt_dur(p.wall_s)} |"
        )
    add(
        f"| **total** | | {sum(p.assistant_turns for p in parts)} | "
        f"**{fmt_int(sum(p.uncached for p in parts))}** | "
        f"{fmt_int(sum(p.output for p in parts))} | "
        f"{fmt_int(sum(p.thinking for p in parts))} | "
        f"{fmt_int(sum(p.cache_create for p in parts))} | "
        f"{fmt_int(sum(p.cache_read for p in parts))} | "
        f"{sum(sum(p.tools.values()) for p in parts)} | {fmt_dur(span)} |"
    )
    add("")

    add("## Dispatch order")
    add("")
    all_dispatches = [(p, d) for p in parts for d in p.dispatches]
    if not all_dispatches:
        add("No subagent was dispatched — this was a single-context run.")
    else:
        all_dispatches.sort(key=lambda pair: pair[1].get("at") or "")
        base = min(starts) if starts else None
        add("| # | at | by | agent | model | prompt chars | description |")
        add("|---|---|---|---|---|---|---|")
        for i, (owner, d) in enumerate(all_dispatches, 1):
            when = ts(d.get("at"))
            offset = fmt_dur((when - base).total_seconds()) if when and base else "—"
            model = d.get("resolved_model") or d.get("model_arg") or "inherited"
            add(
                f"| {i} | +{offset} | {owner.label} | {d['subagent_type']} | {model} | "
                f"{fmt_int(d['prompt_chars'])} | {d['description']} |"
            )
        add("")
        overlaps = []
        for i, a in enumerate(parts[1:]):
            for b in parts[1 + i + 1:]:
                if a.first and a.last and b.first and b.last and a.first < b.last and b.first < a.last:
                    overlaps.append(f"{a.label} ‖ {b.label}")
        add(
            "Concurrent pairs: " + (", ".join(overlaps) if overlaps else "none — every dispatch ran alone")
        )
    add("")

    add("## Duplicated reading")
    add("")
    add("A path opened by more than one participant. Each row is context paid for twice:")
    add("the second reader spent its own tokens on bytes another had already summarised.")
    add("")
    touched: dict[str, Counter] = defaultdict(Counter)
    for p in parts:
        for path, n in p.reads.items():
            # Re-reading a file you are WRITING is authoring, not duplication —
            # the writer greps its own draft, and counting that buries the real
            # rows (a spec author re-read its own file 59 times in one run).
            if path and path not in p.writes:
                touched[path][p.label] += n
    shared = {
        path: readers for path, readers in touched.items() if len(readers) > 1
    }
    if not shared:
        add("None — no path was opened by two participants.")
    else:
        add("| path | readers | opens |")
        add("|---|---|---|")
        for path, readers in sorted(shared.items(), key=lambda kv: -sum(kv[1].values()))[:top]:
            add(f"| `{path}` | {len(readers)}: {', '.join(sorted(readers))} | {sum(readers.values())} |")
        if len(shared) > top:
            add(f"| … {len(shared) - top} more | | |")
    add("")

    repeats = []
    for p in parts:
        for cmd, n in p.commands.items():
            if n > 1:
                repeats.append((n, p.label, cmd))
    cross: dict[str, set] = defaultdict(set)
    for p in parts:
        for cmd in p.commands:
            cross[cmd].add(p.label)
    cross_repeats = [(cmd, labels) for cmd, labels in cross.items() if len(labels) > 1]
    if repeats or cross_repeats:
        add("### Repeated commands")
        add("")
        for n, label, cmd in sorted(repeats, reverse=True)[:top]:
            add(f"- {label} ran the same command {n}×: `{cmd[:120]}`")
        for cmd, labels in sorted(cross_repeats, key=lambda kv: -len(kv[1]))[:top]:
            add(f"- run by {len(labels)} participants ({', '.join(sorted(labels))}): `{cmd[:120]}`")
        add("")

    add("## Friction")
    add("")
    any_friction = False
    for p in parts:
        if not p.errors and not p.empty_bash:
            continue
        any_friction = True
        add(f"**{p.label}** — {len(p.errors)} failed tool call(s), {p.empty_bash} empty result(s)")
        seen: set[str] = set()
        for tool, body in p.errors[:top]:
            key = f"{tool}:{body[:60]}"
            if key in seen:
                continue
            seen.add(key)
            add(f"- `{tool}` — {body}")
        add("")
    if not any_friction:
        add("No failed tool call and no empty result in any participant.")
        add("")

    add("## Rework")
    add("")
    add("A file one participant wrote and another edited afterwards — the signal that a")
    add("dispatch's output needed correcting rather than accepting.")
    add("")
    rework = []
    for writer in parts:
        for path in writer.writes:
            for other in parts:
                if other is writer or path not in other.writes:
                    continue
                if writer.last and other.last and other.last > writer.last:
                    rework.append((path, writer.label, other.label))
    if not rework:
        add("None — no file was written by one participant and re-edited by another.")
    else:
        for path, first, second in rework[:top]:
            add(f"- `{path}` — written by {first}, later edited by {second}")
    add("")

    add("## Tool histogram")
    add("")
    add("| participant | " + " | ".join(["tools used"]) + " |")
    add("|---|---|")
    for p in parts:
        hist = ", ".join(f"{name} {n}" for name, n in p.tools.most_common())
        add(f"| {p.label} | {hist or '—'} |")
    add("")
    add("---")
    add("")
    add("Facts only. Every judgement about them belongs in the retro report.")
    return "\n".join(out)


# --------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Measure one session's multi-agent run.")
    ap.add_argument("--session")
    ap.add_argument("--transcript")
    ap.add_argument("--project-dir")
    ap.add_argument("--top", type=int, default=8)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    pdir = Path(args.project_dir) if args.project_dir else project_dir(Path.cwd())
    if args.transcript:
        transcript = Path(args.transcript)
    elif args.session:
        transcript = pdir / f"{args.session}.jsonl"
    else:
        found = newest_transcript(pdir)
        if not found:
            print(f"No transcript found under {pdir}.")
            print("Pass --transcript <path>, or check that this is the right project directory.")
            return 1
        transcript = found

    if not transcript.exists():
        print(f"Transcript not found: {transcript}")
        return 1

    root = Path.cwd()
    tool_names: dict[str, str] = {}
    main_part = Participant("main", "main loop")
    scan(transcript, main_part, tool_names, root)
    parts = [main_part]

    # Subagent transcripts live beside the session file, one per agent id.
    # Two passes on purpose. A nested dispatch is declared inside a SUBAGENT's
    # transcript, so the agent-type of a grandchild is unknown until every file
    # has been scanned — labelling during the walk leaves them as "subagent",
    # which is exactly the row a reader most needs named.
    subdir = transcript.parent / transcript.stem / "subagents"
    for path in sorted(subdir.glob("agent-*.jsonl")) if subdir.is_dir() else []:
        agent_id = path.stem[len("agent-"):]
        part = Participant(agent_id, f"subagent ({agent_id[:8]})")
        scan(path, part, tool_names, root)
        parts.append(part)

    dispatch_of: dict[str, tuple[Participant, dict]] = {}
    for owner in parts:
        for d in owner.dispatches:
            if d.get("agent_id"):
                dispatch_of[d["agent_id"]] = (owner, d)

    for p in parts[1:]:
        owner, d = dispatch_of.get(p.key, (None, None))
        kind = (d or {}).get("subagent_type") or "subagent"
        depth = ""
        if owner is not None:
            p.parent = owner.key
            depth = "" if owner.key == "main" else "↳ "
        p.label = f"{depth}{kind} ({p.key[:8]})"

    if args.json:
        print(
            json.dumps(
                {
                    "transcript": str(transcript),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "participants": [
                        {
                            "label": p.label,
                            "parent": p.parent,
                            "models": dict(p.models),
                            "turns": p.assistant_turns,
                            "uncached_tokens": p.uncached,
                            "output_tokens": p.output,
                            "thinking_tokens": p.thinking,
                            "cache_creation_tokens": p.cache_create,
                            "cache_read_tokens": p.cache_read,
                            "tools": dict(p.tools),
                            "errors": [{"tool": t, "message": m} for t, m in p.errors],
                            "empty_results": p.empty_bash,
                            "wall_seconds": round(p.wall_s, 1),
                            "dispatches": p.dispatches,
                        }
                        for p in parts
                    ],
                },
                indent=2,
            )
        )
    else:
        print(render(parts, transcript, args.top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
