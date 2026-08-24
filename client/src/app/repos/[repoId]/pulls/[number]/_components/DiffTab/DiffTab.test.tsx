/* DiffTab — the container, so what is tested here is the DEGRADATION LADDER.

   Smart Diff is an ordering, and an ordering has no partial state: the tab either
   shows the grouping, or a skeleton, or the plain diff it showed before this feature
   existed. The case that matters most is the last one — a failed grouping request
   must not cost the reviewer the diff.

   Needs a QueryClient (unlike `SmartDiffViewer`, which is presentational): this is
   the component that owns the queries. There is no shared test helper for one, so it
   is built inline, the way `PRRow.test.tsx` and `AgentCard.test.tsx` do. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

const M = messages.smartDiff;

const FILES: PrFile[] = [
  {
    path: "src/config.ts",
    additions: 1,
    deletions: 0,
    patch: ['@@ -11,2 +11,3 @@ export const config = {', "   port: 3000,", '+  stripeKey: "sk_live_x",'].join("\n"),
  },
] as PrFile[];

/** Stubbed at the `fetch` boundary, not at `api`, so `apiFetch` stays in the path. */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Never resolves — the loading state. */
function pending() {
  return new Promise<Response>(() => {});
}

const SMART_DIFF = {
  groups: [
    {
      role: "wiring",
      files: [
        { path: "src/config.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function mount(over: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
        <DiffTab
          prId="pr-1"
          filesCount={1}
          files={FILES}
          additions={1}
          deletions={0}
          reviews={[]}
          order="smart"
          onOrderChange={vi.fn()}
          onOpenFinding={vi.fn()}
          {...over}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The notice's copy, from the catalogue — never a literal retyped here. */
function targetMissingText(path: string) {
  return M.targetMissing.replace("{path}", path);
}

/** Route every request by URL, so comments and smart-diff can differ per case. */
function route(handlers: Record<string, () => Promise<Response> | Response>) {
  fetchMock.mockImplementation((url: string) => {
    for (const [fragment, handler] of Object.entries(handlers)) {
      if (String(url).includes(fragment)) return Promise.resolve(handler());
    }
    return Promise.resolve(json([]));
  });
}

describe("DiffTab — the header", () => {
  it("labels the section and summarises the PR's own totals", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    const { container } = mount();
    await waitFor(() => expect(screen.getByText("src/config.ts")).toBeTruthy());
    // "Reviewer-ordered diff" — uppercased by SectionLabel in CSS, so the DOM text
    // is the sentence-case string in the catalogue.
    expect(container.textContent).toContain(M.label);
    expect(container.textContent).toContain("1 files · +1 −0");
  });

  it("offers both orders as a radio group", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    mount();
    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeTruthy());
    expect(screen.getByRole("radio", { name: M.order.smart })).toBeTruthy();
    expect(screen.getByRole("radio", { name: M.order.original })).toBeTruthy();
  });
});

describe("DiffTab — while the grouping loads", () => {
  it("shows skeletons rather than the wrong order", async () => {
    route({ "smart-diff": () => pending() as unknown as Response });
    const { container } = mount();
    // Painting the flat diff first and reordering it under the reader is worse than
    // a moment of nothing, because the ORDER is the feature.
    await waitFor(() =>
      expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0),
    );
    expect(container.textContent).not.toContain("sk_live_x");
    expect(screen.queryByText(M.groups.wiring.label)).toBeNull();
  });
});

describe("DiffTab — when the grouping fails", () => {
  it("keeps the diff and says the grouping is unavailable", async () => {
    route({
      "smart-diff": () => json({ error: { code: "internal_error", message: "boom" } }, 500),
    });
    const { container } = mount();

    await waitFor(() => expect(screen.getByText(M.unavailable)).toBeTruthy());
    // The whole point: the reviewer still gets the diff.
    expect(container.textContent).toContain("src/config.ts");
    expect(container.textContent).toContain("sk_live_x");
    // …but with no group headers, because there is no grouping.
    expect(screen.queryByText(M.groups.wiring.label)).toBeNull();
  });

  it("forces the toggle to Original and makes Smart unavailable", async () => {
    route({
      "smart-diff": () => json({ error: { code: "internal_error", message: "boom" } }, 500),
    });
    mount();
    await waitFor(() => expect(screen.getByText(M.unavailable)).toBeTruthy());
    expect(screen.getByRole("radio", { name: M.order.original }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: M.order.smart }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("DiffTab — when the grouping arrives", () => {
  it("renders the grouped viewer", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    mount();
    await waitFor(() => expect(screen.getByText(M.groups.wiring.label)).toBeTruthy());
    expect(screen.queryByText(M.unavailable)).toBeNull();
  });
});

/* Being sent to a file that is not here.

   This is not a defensive branch: `files` is ONE page of at most 100 files from
   GitHub, while whoever sends the reader grounds against the PR's full `pr_files`
   list, so on a large pull request the target is a real changed file and absent
   from this tab at the same time. The reader must be told, or the click looks
   broken. */
describe("DiffTab — when the targeted file is not in the rendered diff", () => {
  it("names the file it cannot show, and keeps the rest of the tab", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    const { container } = mount({ targetFile: "src/api/users.ts", targetLine: 42 });

    // Wait for the grouping, so this asserts the notice ALONGSIDE the diff rather
    // than during the skeleton, when no file is on the page anyway.
    await waitFor(() => expect(screen.getByText("src/config.ts")).toBeTruthy());
    expect(screen.getByText(targetMissingText("src/api/users.ts"))).toBeTruthy();
    // The notice replaces nothing: the diff that DID arrive is still rendered.
    expect(container.textContent).toContain("src/config.ts");
    expect(screen.queryByText(M.unavailable)).toBeNull();
  });

  it("says nothing when the targeted file did arrive", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    const { container } = mount({ targetFile: "src/config.ts", targetLine: 12 });

    await waitFor(() => expect(screen.getByText("src/config.ts")).toBeTruthy());
    expect(screen.queryByText(targetMissingText("src/config.ts"))).toBeNull();
    // And the target reaches the viewer: `src/config.ts` is wiring with no
    // findings, so the rule collapses it and only the target opens it.
    expect(container.textContent).toContain("sk_live_x");
  });

  it("still names it when the grouping failed and the flat diff is showing", async () => {
    route({
      "smart-diff": () => json({ error: { code: "internal_error", message: "boom" } }, 500),
    });
    mount({ targetFile: "src/api/users.ts" });

    // Both notices: the grouping is gone AND the file is not here. The second is
    // about the file list, which the degraded branch renders just the same.
    expect(await screen.findByText(M.unavailable)).toBeTruthy();
    expect(screen.getByText(targetMissingText("src/api/users.ts"))).toBeTruthy();
  });
});

describe("DiffTab — it never asks a model for anything", () => {
  /**
   * The client-side half of the "no new model call" acceptance criterion. The server
   * proves no provider was reached; this proves the tab never POSTs at all, which is
   * the shape a "re-classify" button would take. `hooks/intent.ts` — the file
   * `hooks/smart-diff.ts` is modelled on — ships exactly such a mutation, so copying
   * it wholesale is a live risk rather than a hypothetical one.
   */
  it("issues only GETs, and none of them to a derive endpoint", async () => {
    route({ "smart-diff": () => json(SMART_DIFF) });
    mount();
    await waitFor(() => expect(screen.getByText(M.groups.wiring.label)).toBeTruthy());

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [url, init] of calls) {
      expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
      expect(String(url)).not.toMatch(/intent|derive|classify/);
    }
  });
});
