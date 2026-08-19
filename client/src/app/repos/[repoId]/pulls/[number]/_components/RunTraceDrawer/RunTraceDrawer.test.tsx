import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import { estimateTokens } from "@/lib/skill";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

/** The exact text the engine sends in the `specs` slot: it wraps each document
    itself (`reviewer-core/src/prompt.ts`), so the trace stores the wrapper too. */
const SPECS_BLOCK =
  '<untrusted source="spec-0">\n# Public API\nEvery endpoint is versioned.\n</untrusted>\n' +
  '<untrusted source="spec-1">\n# Architecture\nOne module per capability.\n</untrusted>';

/** A run that carried project context: paths read, and the block that was sent. */
const TRACE_WITH_CONTEXT: RunTrace = {
  ...TRACE,
  specs_read: ["specs/public-api.md", "docs/architecture.md"],
  prompt_assembly: { ...TRACE.prompt_assembly, specs: SPECS_BLOCK },
};

/** A trace persisted before `specs_read` existed. The server hands the stored
    jsonb back by a CAST, not a Zod parse, so the key is ABSENT — not null. */
const LEGACY_TRACE = (() => {
  const partial: Partial<RunTrace> = { ...TRACE };
  delete partial.specs_read;
  return partial as RunTrace;
})();

/** What `useRunTrace` returns for the test currently running. */
let current: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: current, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  current = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("shows the COST stat tile alongside duration, tokens and findings", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    // 0.06 falls in the "< $1 → 3dp" band of the adaptive rule.
    expect(screen.getByText("$0.060")).toBeInTheDocument();
    expect(screen.getByText("8.2s")).toBeInTheDocument();
    expect(screen.getByText("12K→1.5K")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  it("lists every document read and opens the project-context block with the text that was sent", () => {
    current = TRACE_WITH_CONTEXT;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    // Every path in `specs_read` is listed under "Specs read".
    expect(screen.getByText(messages.trace.config.specsRead)).toBeInTheDocument();
    for (const path of TRACE_WITH_CONTEXT.specs_read) {
      expect(screen.getByText(path)).toBeInTheDocument();
    }
    expect(screen.queryByText(messages.trace.config.none)).not.toBeInTheDocument();

    // "Prompt assembly" is collapsed by default; open it, then the block.
    fireEvent.click(screen.getByText(messages.trace.promptAssembly));
    const label = screen.getByText(messages.trace.prompt.specs);

    // The block's approximate token cost sits beside its label.
    const tokens = estimateTokens(SPECS_BLOCK);
    expect(tokens).toBeGreaterThan(0);
    expect(screen.getByText(`${tokens} tokens`)).toBeInTheDocument();

    // Opened, it shows what was sent — `<untrusted source="spec-0">` and all.
    fireEvent.click(label);
    const block = screen.getByText(/<untrusted source="spec-0">/);
    expect(block.textContent).toBe(SPECS_BLOCK);
  });

  it("renders the empty specs row for a trace stored before `specs_read` existed", () => {
    current = LEGACY_TRACE;
    // The key is absent, not null: reading `.length` off it would throw here.
    expect(() =>
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />),
    ).not.toThrow();
    expect(screen.getByText(messages.trace.config.specsRead)).toBeInTheDocument();
    expect(screen.getByText(messages.trace.config.none)).toBeInTheDocument();
  });
});
