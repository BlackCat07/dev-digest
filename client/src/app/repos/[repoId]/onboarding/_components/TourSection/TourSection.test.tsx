/**
 * TourSection — one section of the Onboarding Tour.
 *
 * Covers AC-35 (the heading the rail links to), AC-36, AC-37, AC-38, AC-39,
 * AC-45 and AC-47 of `specs/onboarding-generator.md`.
 *
 * The card is prop-driven and calls no data hook, so it mounts with
 * `NextIntlClientProvider` alone — no `QueryClient`, no router. Interaction is
 * `fireEvent`: `@testing-library/user-event` is NOT a dependency of this package
 * and importing it fails at collect time (`client/INSIGHTS.md`, 2026-08-10).
 *
 * **`mermaid` is mocked; `MermaidDiagram` is not.** The boundary here is the
 * third-party library — it needs a real browser and is imported lazily — and
 * mocking the wrapper component instead would make AC-38 a test of the mock: the
 * component owns BOTH failure modes (a string that fails its own regex, and one
 * that passes it and is then rejected by `mermaid.parse`), and it is the second
 * one EC-12 is about. The stub's `parse` therefore reproduces exactly that:
 * it refuses an unquoted `/` inside a node label.
 *
 * `navigator.clipboard` does not exist in jsdom, so it is defined per-case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourSection } from "@devdigest/shared";
import onboardingMessages from "../../../../../../../messages/en/onboarding.json";
import { TourSection } from "./TourSection";
import { sectionHeadingId } from "./helpers";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    /** Rejects an unquoted `/` in a node label — EC-12's exact case. */
    parse: vi.fn(async (src: string) => !/\[[^\]"]*\//.test(src)),
    render: vi.fn(async (_id: string, src: string) => ({
      svg: `<svg role="img" aria-label="diagram"><title>${src}</title></svg>`,
    })),
  },
}));

const SHA = "abc1234def";
const REPO = "acme/payments-api";

const writeText = vi.fn();

function section(over: Partial<OnboardingTourSection> = {}): OnboardingTourSection {
  return {
    kind: "architecture",
    title: "Architecture",
    body: "A short paragraph.",
    diagram: null,
    links: [],
    commands: [],
    paths: [],
    tasks: [],
    ...over,
  };
}

function mount(props: Partial<React.ComponentProps<typeof TourSection>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: onboardingMessages }}>
      <TourSection
        section={section()}
        repoFullName={REPO}
        indexedSha={SHA}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("the section body is rendered as a document (AC-36)", () => {
  it("renders a heading, a list and a fenced code block, not one wall of text", () => {
    mount({
      section: section({
        body: ["## Heading", "", "- item", "- second item", "", "```ts", "const x = 1;", "```"].join(
          "\n",
        ),
      }),
    });

    // The vendored `<Markdown>` primitive maps p/strong/code/a and nothing else,
    // so a document-shaped body collapses through it — this card brings its own
    // renderer instead (`client/INSIGHTS.md`, 2026-08-05).
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    const item = screen.getByText("item");
    expect(item.tagName).toBe("LI");
    expect(item.closest("ul")).not.toBeNull();
    expect(screen.getByText("const x = 1;").closest("pre")).not.toBeNull();
  });

  it("gives the section a heading the on-this-page rail can resolve (AC-35)", () => {
    mount({ section: section({ kind: "reading_path", title: "Reading path" }) });

    const heading = screen.getByRole("heading", { name: "Reading path" });
    // One id function, two callers: the rail's `href="#…"` and this heading. A
    // rail that built its own id from the same `kind` would be a hand-synced
    // invariant whose failure is a link that silently scrolls nowhere.
    expect(heading.id).toBe(sectionHeadingId("reading_path"));
    expect(document.querySelector(`[aria-labelledby="${heading.id}"]`)).not.toBeNull();
  });

  it("falls back to the catalogue's title when the stored section has none", () => {
    mount({ section: section({ kind: "first_tasks", title: "   " }) });
    expect(
      screen.getByRole("heading", { name: onboardingMessages.sectionTitle.first_tasks }),
    ).toBeInTheDocument();
  });
});

describe("the diagram (AC-37, AC-38)", () => {
  it("sends a valid diagram to the diagram renderer rather than printing it as text", async () => {
    const chart = 'flowchart LR\n  A["client"] --> B["api"]';
    mount({ section: section({ diagram: chart }) });

    // Rendered as a diagram: the mermaid stub's SVG is in the tree, carrying the
    // source it was handed.
    const svg = await screen.findByRole("img", { name: "diagram" });
    // `textContent` rather than a text query: the source carries a newline and
    // an accessible-text query normalises whitespace away.
    expect(svg.textContent).toContain(chart);
    // And no notice, because nothing failed.
    expect(screen.queryByText(onboardingMessages.diagram.unavailable)).not.toBeInTheDocument();
    // The body is still there beside it.
    expect(screen.getByText("A short paragraph.")).toBeInTheDocument();
  });

  it("keeps the rest of the section when the diagram cannot be rendered (AC-38)", async () => {
    // EC-12: an unquoted `/` inside a node label passes the component's own
    // regex and is then refused by `mermaid.parse` — the failure a caller
    // pre-validating with its own copy of that regex would miss.
    mount({
      section: section({
        diagram: "flowchart LR\n  A[client/web] --> B[api]",
        body: "The body survives.",
        links: [{ label: "Entrypoint", path: "src/server.ts" }],
      }),
    });

    expect(
      await screen.findByText(onboardingMessages.diagram.unavailable),
    ).toBeInTheDocument();
    // The body, the links and the heading are exactly where they were, and the
    // render did not throw.
    expect(screen.getByText("The body survives.")).toBeInTheDocument();
    expect(screen.getByText("Entrypoint")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "diagram" })).not.toBeInTheDocument();
  });

  it("treats an empty diagram string as no diagram at all (EC-13)", async () => {
    mount({ section: section({ diagram: "   " }) });

    // Not an unavailable-diagram notice: nobody claimed there was one.
    await waitFor(() => expect(screen.getByText("A short paragraph.")).toBeInTheDocument());
    expect(screen.queryByText(onboardingMessages.diagram.unavailable)).not.toBeInTheDocument();
  });
});

describe("the run-locally commands (AC-39, AC-45)", () => {
  const withCommands = () =>
    section({
      kind: "run_locally",
      title: "Run locally",
      commands: [
        { command: "npm run dev  # starts vite on :5173", file: "package.json", order: 0 },
        { command: "make test", file: "Makefile", order: 1 },
      ],
    });

  it("copies the command verbatim, and shows the file it was declared in", () => {
    mount({ section: withCommands() });

    // The accessible name collapses the command's double space, as any
    // accessible-name computation does — which is exactly why the CLIPBOARD
    // assertion below, not this query, is the one AC-39 turns on.
    const copy = screen.getByRole("button", { name: /Copy the command npm run dev/ });
    fireEvent.click(copy);

    // VERBATIM — the double space and the trailing comment included. What the
    // reader copies has to be what they read.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("npm run dev  # starts vite on :5173");

    // AC-21's client half: every command names its declaring file.
    expect(screen.getByText("Declared in package.json")).toBeInTheDocument();
    expect(screen.getByText("Declared in Makefile")).toBeInTheDocument();
    // Nothing was executed, and the card says so.
    expect(screen.getByText(onboardingMessages.command.notRun)).toBeInTheDocument();
  });

  it("copies only the command whose control was used", () => {
    mount({ section: withCommands() });

    fireEvent.click(screen.getByRole("button", { name: /make test/ }));

    expect(writeText).toHaveBeenCalledWith("make test");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("is operable without a pointer (AC-45)", () => {
    mount({ section: withCommands() });

    const [copy] = screen.getAllByRole("button");
    // The load-bearing half: a real, tab-reachable BUTTON with an accessible
    // name, not a `div` with an `onClick`. jsdom synthesizes no click for Enter
    // on a focused native button and `user-event` is not a dependency here
    // (`client/INSIGHTS.md`, 2026-08-19), so activation is dispatched separately
    // below and demonstrated in a browser — the spec's own AC-45 says exactly
    // this.
    expect(copy!.tagName).toBe("BUTTON");
    expect(copy).toHaveAccessibleName();
    copy!.focus();
    expect(copy).toHaveFocus();
    expect(copy).not.toHaveAttribute("tabindex", "-1");

    fireEvent.click(document.activeElement!);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("says so honestly when the repository declares no command (EC-8)", () => {
    mount({ section: section({ kind: "run_locally", title: "Run locally", commands: [] }) });

    expect(screen.getByText(onboardingMessages.command.none)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("opening a file the tour names (AC-47)", () => {
  const withRows = () =>
    section({
      kind: "reading_path",
      title: "Reading path",
      paths: [
        { path: "src/server.ts", reason: "Boots the API." },
        { path: "src/modules/index.ts", reason: "Registers every module." },
      ],
    });

  it("links to the repository host at the SHA the tour records, in a new tab", () => {
    mount({ section: withRows() });

    const open = screen.getAllByRole("link", { name: /^Open/ });
    expect(open).toHaveLength(2);
    // The tour's OWN commit, never the repository's default branch: a tour and
    // the file it describes are read at the same revision even after the branch
    // has moved (AC-25, EC-20).
    expect(open[0]).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${SHA}/src/server.ts`,
    );
    expect(open[1]).toHaveAttribute(
      "href",
      `https://github.com/${REPO}/blob/${SHA}/src/modules/index.ts`,
    );
    expect(open[0]).toHaveAttribute("target", "_blank");
    expect(open[0]?.getAttribute("rel")).toContain("noopener");
    // A link is keyboard-reachable and named for the row it belongs to (AC-45).
    expect(open[0]).toHaveAccessibleName("Open src/server.ts on the repository host");

    // Both rows are still readable as rows.
    expect(screen.getByText("Boots the API.")).toBeInTheDocument();
    expect(screen.getByText("src/modules/index.ts")).toBeInTheDocument();
  });

  it("renders no Open control, and says why, when the tour recorded no commit", () => {
    // A degraded tour generated with no index has no SHA; a link pinned to a
    // branch would open code this tour never read.
    mount({ section: withRows(), indexedSha: null });

    expect(screen.queryByRole("link", { name: /^Open/ })).not.toBeInTheDocument();
    expect(screen.getByText(onboardingMessages.path.unavailable)).toBeInTheDocument();
    expect(screen.getByText("Boots the API.")).toBeInTheDocument();
  });

  it("renders no Open control when the repository name is not known yet", () => {
    mount({ section: withRows(), repoFullName: undefined });
    expect(screen.queryByRole("link", { name: /^Open/ })).not.toBeInTheDocument();
  });
});

describe("first tasks carry their complexity as a word (a11y)", () => {
  it("names the level in text, never by colour alone", () => {
    mount({
      section: section({
        kind: "first_tasks",
        title: "First tasks",
        tasks: [
          { title: "Add a health check", path: "src/routes.ts", complexity: "low" },
          { title: "Split the executor", path: "src/modules/reviews/", complexity: "high" },
        ],
      }),
    });

    expect(screen.getByText("Complexity: Low")).toBeInTheDocument();
    expect(screen.getByText("Complexity: High")).toBeInTheDocument();
    expect(screen.getByText("Add a health check")).toBeInTheDocument();
  });
});
