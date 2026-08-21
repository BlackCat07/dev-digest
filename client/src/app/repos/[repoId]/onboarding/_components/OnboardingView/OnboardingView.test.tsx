/**
 * OnboardingView — the Onboarding Tour screen, one flow per state.
 *
 * Covers AC-31, AC-33, AC-34, AC-35, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45
 * and AC-46 of `specs/onboarding-generator.md`.
 *
 * Three choices carry more than their length:
 *
 *  - **The real `AppShell` is mounted, not a fake one.** AC-34 and AC-44 both
 *    promise that the rest of the app stays usable while this screen is busy or
 *    broken, and that is only assertable against the REAL sidebar. `AppShell`
 *    mounts cleanly in jsdom with `next/navigation` mocked, a `QueryClient` and
 *    the `shell` namespace (`client/INSIGHTS.md`, 2026-08-19) — which is also
 *    what makes AC-31's sidebar order observable here.
 *  - **The data layer is mocked at its own module boundary**, the seam the screen
 *    is written against, and `fetch` is stubbed underneath for the shell's own
 *    queries so no test reaches the network.
 *  - **`fireEvent`, never `userEvent`** — that package is not a dependency here
 *    and importing it fails at collect time (`client/INSIGHTS.md`, 2026-08-10) —
 *    and both i18n namespaces the tree reaches are provided, because a missing
 *    one renders the key path and logs `IntlError: MISSING_MESSAGE` into stderr
 *    while the run stays green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingTour, OnboardingTourSection, Repo } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { RepoProvider } from "@/lib/repo-context";
import { OnboardingView } from "./OnboardingView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/repos/r1/onboarding",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound() was called");
  },
}));

/* The diagram renderer's third-party library, stubbed at its own boundary: it
   needs a real browser. The wrapper component stays real. */
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(async () => true),
    render: vi.fn(async () => ({ svg: "<svg></svg>" })),
  },
}));

type QueryLike<T> = { data: T | undefined; isLoading: boolean; isError: boolean };
type MutationLike = {
  mutate: () => void;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
};

let tourResult: QueryLike<OnboardingTour>;
let generateResult: MutationLike;

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: () => tourResult,
  useGenerateOnboarding: () => generateResult,
}));

const REPO: Repo = {
  id: "r1",
  workspace_id: "ws-1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/clones/acme/payments-api",
  last_polled_at: "2026-08-19T08:00:00.000Z",
  created_by: null,
};

const KINDS = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
] as const;

function section(over: Partial<OnboardingTourSection> & Pick<OnboardingTourSection, "kind">) {
  return {
    title: onboardingMessages.sectionTitle[over.kind],
    body: `Body of ${over.kind}.`,
    diagram: null,
    links: [],
    commands: [],
    paths: [],
    tasks: [],
    ...over,
  } as OnboardingTourSection;
}

function tour(over: Partial<OnboardingTour> = {}): OnboardingTour {
  return {
    sections: KINDS.map((kind) => section({ kind })),
    status: "ok",
    reason: null,
    generation_state: "ready",
    // Two hours ago, so the caption's age is a stable "2h" whenever this runs.
    generated_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    indexed_sha: "abc1234",
    stale: false,
    files_indexed: 312,
    files_skipped: 0,
    model: "deepseek/deepseek-v4-flash",
    attempts: 1,
    tokens_in: 900,
    tokens_out: 300,
    cost_usd: 0.004,
    ...over,
  };
}

const writeText = vi.fn();
let qc: QueryClient;

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ onboarding: onboardingMessages, shell: shellMessages }}
      >
        <RepoProvider>
          <OnboardingView repoId="r1" />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // The shell's own queries (repos, pulls) are not what this file is about. The
  // repos list answers with the active repository so the breadcrumb and the
  // header have a name; everything else answers an empty list.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).endsWith("/repos") ? [REPO] : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  tourResult = { data: tour(), isLoading: false, isError: false };
  generateResult = { mutate: vi.fn(), isPending: false, isError: false, error: null };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** Every sidebar link the shell rendered, by accessible name. */
function sidebarLinks(): string[] {
  return screen
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "")
    .filter((label) => label.length > 0);
}

describe("the shell around the screen (AC-31)", () => {
  it("offers Onboarding Tour in the WORKSPACE group, between Pull Requests and Project Context", () => {
    render(tree());

    const labels = sidebarLinks();
    const pulls = labels.indexOf("Pull Requests");
    const onboarding = labels.indexOf("Onboarding Tour");
    const context = labels.indexOf("Project Context");

    expect(pulls).toBeGreaterThanOrEqual(0);
    expect(onboarding).toBe(pulls + 1);
    expect(context).toBe(onboarding + 1);
    // The entry points at the repo-scoped route, with `:repoId` resolved.
    expect(screen.getByRole("link", { name: /Onboarding Tour/ })).toHaveAttribute(
      "href",
      "/repos/r1/onboarding",
    );
  });
});

describe("a repository with no tour (AC-33)", () => {
  it("shows one empty state offering generation, and no empty section cards", () => {
    tourResult = {
      data: tour({
        sections: [],
        generation_state: "never_generated",
        generated_at: null,
        indexed_sha: null,
        status: "degraded",
        reason: "index_missing",
      }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    // The title and the call to action share their wording, so the control is
    // queried by role and the copy by its own sentence.
    expect(
      screen.getByRole("button", { name: onboardingMessages.generate.cta }),
    ).toBeInTheDocument();
    // The empty state's copy names the design's five sections, not the stale
    // five the shipped catalogue used to carry (EC-26).
    expect(screen.getByText(onboardingMessages.generate.body)).toBeInTheDocument();
    // Not five blank cards: a rendered-and-empty tour would say "the tour is
    // written and says nothing", which is the one inference this must not invite.
    for (const kind of KINDS) {
      expect(
        screen.queryByRole("heading", { name: onboardingMessages.sectionTitle[kind] }),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("navigation", { name: onboardingMessages.rail.label })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: onboardingMessages.generate.cta }));
    expect(generateResult.mutate).toHaveBeenCalledTimes(1);
  });
});

describe("while a generation runs (AC-34)", () => {
  it("shows the running state and leaves the rest of the shell navigable", () => {
    tourResult = {
      data: tour({ sections: [], generation_state: "running" }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    // `role="status"`: the state arrives after a poll, so it has to be announced.
    const running = screen.getByRole("status");
    expect(within(running).getByText(onboardingMessages.running.title)).toBeInTheDocument();

    // The REAL sidebar is still there and still clickable — the promise the
    // running state makes about the rest of the app.
    const labels = sidebarLinks();
    expect(labels).toContain("Pull Requests");
    expect(labels).toContain("Project Context");
    // Reachable and pointed at a real route — asserted by focus and href rather
    // than by clicking, because jsdom implements no navigation and the click
    // would only prove jsdom's own refusal.
    const pulls = screen.getByRole("link", { name: /Pull Requests/ });
    expect(pulls).toHaveAttribute("href", "/repos/r1/pulls");
    pulls.focus();
    expect(pulls).toHaveFocus();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("a tour on the screen (AC-35, AC-40, AC-45, AC-46)", () => {
  it("renders the five sections in server order, each reachable from the rail (AC-35)", () => {
    // Deliberately a NON-alphabetical, contract order, and the payload is
    // rendered as given — no sort, no per-kind lookup.
    render(tree());

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent?.trim());
    expect(headings).toEqual([
      "Architecture",
      "Critical paths",
      "Run locally",
      "Reading path",
      "First tasks",
    ]);

    const rail = screen.getByRole("navigation", { name: onboardingMessages.rail.label });
    const links = within(rail).getAllByRole("link");
    expect(links).toHaveLength(5);
    // Every rail link resolves to a heading that is actually in the document.
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("#")).toBe(true);
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
    expect(links.map((l) => l.textContent?.trim())).toEqual(headings);
  });

  it("shows the tour’s own coverage and age beside the title (AC-40)", () => {
    tourResult = {
      data: tour({ files_indexed: 312, files_skipped: 40 }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    // The figures are the TOUR's recorded ones, not the current index state's —
    // an old tour must not claim today's coverage.
    expect(screen.getByText(/Generated from 312 files/)).toBeInTheDocument();
    expect(screen.getByText(/2h ago/)).toBeInTheDocument();
    expect(screen.getByText(/40 files skipped/)).toBeInTheDocument();
  });

  it("copies this screen’s own URL and nothing else when Share link is used (AC-46)", () => {
    render(tree());

    const share = screen.getByRole("button", { name: onboardingMessages.share.ariaLabel });
    fireEvent.click(share);

    // No token, no alternate host, no expiring parameter — and no request left
    // the browser, because there is nothing to mint (N14).
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("share");
    }
    expect(screen.getByText(onboardingMessages.share.copied)).toBeInTheDocument();
  });

  it("keeps regenerate and share reachable without a pointer (AC-45)", () => {
    render(tree());

    const share = screen.getByRole("button", { name: onboardingMessages.share.ariaLabel });
    const regenerate = screen.getByRole("button", { name: onboardingMessages.regenerate });

    // Real buttons with accessible names, so activation is the browser's own.
    // jsdom synthesizes no click for Enter on a focused native button and
    // `user-event` is not available here, so activation is dispatched
    // separately and demonstrated in a browser — the spec's own AC-45.
    for (const control of [share, regenerate]) {
      expect(control.tagName).toBe("BUTTON");
      expect(control).toHaveAccessibleName();
      control.focus();
      expect(control).toHaveFocus();
      expect(control).not.toHaveAttribute("tabindex", "-1");
    }
    for (const link of within(
      screen.getByRole("navigation", { name: onboardingMessages.rail.label }),
    ).getAllByRole("link")) {
      expect(link).toHaveAccessibleName();
      link.focus();
      expect(link).toHaveFocus();
    }

    fireEvent.click(regenerate);
    expect(generateResult.mutate).toHaveBeenCalledTimes(1);
  });
});

describe("notices sit above the sections, never instead of them (AC-41, AC-42, AC-43)", () => {
  it("labels a stale tour and still renders all five sections (AC-41)", () => {
    tourResult = { data: tour({ stale: true }), isLoading: false, isError: false };
    render(tree());

    expect(screen.getByText(onboardingMessages.notice.stale.title)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
    // Above them: hiding the data would be less honest than labelling it.
    const notice = screen.getByText(onboardingMessages.notice.stale.title);
    const firstHeading = screen.getAllByRole("heading", { level: 2 })[0]!;
    expect(
      notice.compareDocumentPosition(firstHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("labels a partial tour with the reason the index gave (AC-41)", () => {
    tourResult = {
      data: tour({ status: "partial", reason: "index_partial" }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    expect(screen.getByText(onboardingMessages.notice.partial.title)).toBeInTheDocument();
    expect(screen.getByText(onboardingMessages.reason.index_partial)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
  });

  it("shows the degraded skeleton under a notice naming the cause (AC-42)", () => {
    tourResult = {
      data: tour({ status: "degraded", reason: "model_timeout" }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    expect(screen.getByText(onboardingMessages.notice.degraded.title)).toBeInTheDocument();
    // The cause is named, in words.
    expect(screen.getByText(onboardingMessages.reason.model_timeout)).toBeInTheDocument();
    // The skeleton's sections still render, and the copy does not read as a
    // complete tour.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
    expect(screen.getByText(onboardingMessages.notice.degraded.body)).toBeInTheDocument();
  });

  it("renders the generic sentence for a reason it does not recognise (AC-43)", () => {
    // A server one version ahead can send a reason this build has never heard
    // of. The cast is the case: the contract's own type cannot express it.
    tourResult = {
      data: tour({ status: "degraded", reason: "quota_exhausted" as OnboardingTour["reason"] }),
      isLoading: false,
      isError: false,
    };
    render(tree());

    expect(screen.getByText(onboardingMessages.reason.generic)).toBeInTheDocument();
    // Neither the enum literal nor a message-key path reaches the screen.
    expect(screen.queryByText(/quota_exhausted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/reason\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/onboarding\.reason/)).not.toBeInTheDocument();
  });
});

describe("when the tour request fails (AC-44)", () => {
  it("shows an inline error and leaves the shell navigable", async () => {
    tourResult = { data: undefined, isLoading: false, isError: true };
    render(tree());

    // The error is held until the repos list has resolved, so that a generic
    // error cannot flash in front of the repo-scoped 404 boundary — hence
    // `findBy` rather than `getBy`.
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(onboardingMessages.loadError.title)).toBeInTheDocument();

    // Inline, on this screen: the sidebar and the breadcrumb are still in the
    // tree, which a full-screen error or a segment error boundary would have
    // taken away with it.
    const labels = sidebarLinks();
    expect(labels).toContain("Pull Requests");
    expect(labels).toContain("Project Context");
    expect(screen.getAllByText(onboardingMessages.title).length).toBeGreaterThan(0);
  });

  it("shows a skeleton while the tour is loading, and no error", () => {
    tourResult = { data: undefined, isLoading: true, isError: false };
    const { container } = render(tree());

    // The vendored `Skeleton` is a bare `div.skeleton` with no role and no aria,
    // so the class is the only handle (`client/INSIGHTS.md`, 2026-08-10).
    expect(container.getElementsByClassName("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the tour on screen when a REGENERATION is refused", () => {
    // Distinct from the tour request's own failure: the server answers 422 while
    // one generation is already running, and the tour below must be untouched.
    generateResult = {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("A generation is already running for this repository"),
    };
    render(tree());

    expect(
      screen.getByText("A generation is already running for this repository"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
  });
});
