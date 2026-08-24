import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectDoc, ProjectDocList, SpecFile } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { RepoProvider } from "@/lib/repo-context";
import { ContextView } from "./ContextView";

/* `@testing-library/user-event` is not a dependency of this package — importing
   it fails at collect time — so interaction here is `fireEvent`, matching every
   other test file in `src/`. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/repos/r1/context",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

/* The data layer is T6's and is mocked at its own module boundary — the seam
   this screen is written against. Both hooks come from the same module, and
   `DocPreview` imports it by the same specifier, so one mock covers the tree. */
type QueryLike<T> = { data: T | undefined; isLoading: boolean; isError: boolean };
let listResult: QueryLike<ProjectDocList>;
let docResult: QueryLike<SpecFile>;

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectDocs: () => listResult,
  useProjectDoc: () => docResult,
}));

const doc = (
  over: Partial<ProjectDoc> & Pick<ProjectDoc, "path" | "root" | "doc_type">,
): ProjectDoc => ({
  size: 1200,
  tokens: 300,
  updated_at: "2026-08-01T10:00:00.000Z",
  used_by_agents: 0,
  ...over,
});

const DOCS: ProjectDoc[] = [
  doc({ path: "docs/architecture.md", root: "docs/", doc_type: "doc", used_by_agents: 1 }),
  doc({ path: "specs/public-api.md", root: "specs/", doc_type: "spec", used_by_agents: 0 }),
  doc({ path: "specs/security-baseline.md", root: "specs/", doc_type: "spec", used_by_agents: 3 }),
];

const LIST: ProjectDocList = {
  docs: DOCS,
  roots: ["specs/", "docs/", "insights/"],
  total: 3,
  truncated: false,
  status: "ok",
  reason: null,
};

let qc: QueryClient;

/** The tree under test. Rebuilt rather than remounted, so a hook result set
    between two renders lands the way a resolving query would. */
function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ context: contextMessages, shell: shellMessages }}
      >
        <RepoProvider>
          <ContextView repoId="r1" />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // The shell's own queries (repos, pulls) are not what this file is about;
  // answering them with an empty list keeps the network out of the test.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ),
  );
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listResult = { data: undefined, isLoading: true, isError: false };
  docResult = { data: undefined, isLoading: false, isError: false };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContextView", () => {
  it("shows a skeleton, then the documents grouped by root, filters them, previews one, and offers no write control", () => {
    // AC-29 — the loading state is the vendored `Skeleton`, a bare
    // `div.skeleton` with no role and no aria, so the class is the only handle.
    const { container, rerender } = render(tree());
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);

    listResult = { data: { ...LIST, total: 9, truncated: true }, isLoading: false, isError: false };
    rerender(tree());
    expect(container.getElementsByClassName("skeleton").length).toBe(0);

    // AC-33 — two roots, two group labels, and each document under the label of
    // the root it came from. The per-row type badge was dropped on 2026-08-19:
    // `doc_type` is derived from the root, so the badge only repeated the
    // heading its own row sat under. The grouping is now the sole carrier, so
    // it is asserted harder — each heading names its own root and each holds
    // only its own documents.
    const specsHeading = screen.getByRole("heading", { name: /specs\// });
    const docsHeading = screen.getByRole("heading", { name: /docs\// });
    expect(specsHeading).not.toBe(docsHeading);

    const specsGroup = specsHeading.parentElement!;
    const docsGroup = docsHeading.parentElement!;
    expect(within(specsGroup).getByText("specs/public-api.md")).toBeInTheDocument();
    expect(within(docsGroup).getByText("docs/architecture.md")).toBeInTheDocument();
    expect(within(specsGroup).queryByText("docs/architecture.md")).toBeNull();
    expect(within(docsGroup).queryByText("specs/public-api.md")).toBeNull();

    // AC-32 — how many exist and how many are shown, both from the response.
    const truncation = screen.getByText(/Showing/);
    expect(truncation).toHaveTextContent("3");
    expect(truncation).toHaveTextContent("9");

    // AC-37 / AC-34 — selecting a document shows how many agents use it, and
    // its body renders as a document rather than a wall of text.
    docResult = {
      data: { path: "specs/security-baseline.md", content: "## Baseline\n\n- no secrets in logs\n" },
      isLoading: false,
      isError: false,
    };
    fireEvent.click(screen.getByRole("button", { name: "Preview specs/security-baseline.md" }));
    expect(screen.getByText("3 agents use this document")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Baseline" })).toBeInTheDocument();

    // AC-36 — case-insensitive filter on the path.
    fireEvent.change(screen.getByRole("textbox", { name: contextMessages.filter.label }), {
      target: { value: "SEC" },
    });
    expect(
      screen.getByRole("button", { name: "Preview specs/security-baseline.md" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview docs/architecture.md" })).toBeNull();

    // AC-35 — a prohibition, asserted as an absence. Nothing on this screen
    // writes to the repository: no save, no edit mode, no new file or folder,
    // no upload — and no re-index or resync either, since both write the clone
    // this screen reads.
    for (const name of [
      /save/i,
      /edit/i,
      /new file/i,
      /new folder/i,
      /upload/i,
      /re-?index/i,
      /resync/i,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByRole("textbox", { name })).toBeNull();
    }
    // …and the one input that IS here is the read-only filter, so the absence
    // above is not just an empty screen.
    expect(screen.queryByRole("textbox", { name: contextMessages.filter.label })).not.toBeNull();
  });

  it("names the searched roots when the repository carries no documents", () => {
    listResult = {
      data: {
        docs: [],
        roots: ["specs/", "docs/", "insights/"],
        total: 0,
        truncated: false,
        status: "ok",
        reason: null,
      },
      isLoading: false,
      isError: false,
    };
    render(tree());

    // AC-30 — each root the walk actually searched appears in the sentence, so
    // "there is nothing here" cannot be confused with "you looked elsewhere".
    const empty = screen.getByText(/Nothing matched under/);
    for (const root of ["specs/", "docs/", "insights/"]) {
      expect(empty).toHaveTextContent(root);
    }
  });

  it("shows the load failure beside the list and leaves the navigation and breadcrumb usable", () => {
    listResult = { data: undefined, isLoading: false, isError: true };
    render(tree());

    // AC-31 — the error renders…
    expect(screen.getByRole("alert")).toHaveTextContent(contextMessages.loadError);

    // …and the rest of the screen is still there and still interactive: the
    // sidebar's links (AC-28's entry among them, pointing at the
    // repository-scoped route) and the breadcrumb.
    const navEntry = screen.getByRole("link", { name: shellMessages.nav.context });
    expect(navEntry).toHaveAttribute("href", "/repos/r1/context");
    expect(screen.getByRole("link", { name: shellMessages.nav.pulls })).toBeInTheDocument();
    expect(screen.getByText(contextMessages.page.crumbWorkspace)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: contextMessages.filter.label })).toBeEnabled();
  });
});
