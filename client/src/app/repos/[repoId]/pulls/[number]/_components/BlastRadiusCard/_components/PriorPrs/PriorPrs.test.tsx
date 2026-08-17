/* PriorPrs — the history footer of the Blast Radius card.

   Mounted with `NextIntlClientProvider` ALONE and no QueryClient: the block is
   presentational and `OverviewTab` owns the hook. A data hook moving into this
   subtree fails here with "No QueryClient set", which is the boundary working
   (client/INSIGHTS.md, 2026-08-03).

   Copy is asserted through `M.*` — the real `messages/en/blast.json` — so a renamed
   key fails at typecheck rather than silently rendering a key path
   (client/INSIGHTS.md, 2026-08-10). `fireEvent`, because `user-event` is not a
   dependency of this package (client/INSIGHTS.md, 2026-08-10).

   The assertion this file exists for is the same one the parent card is built on:
   **an empty list must never render the same way twice for different reasons.**
   "Nothing else touched these files", "this PR's files were never imported" and "no
   other PR has an imported file list" are three different answers, and the block
   would be actively misleading if it blurred them. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrPriorPrs } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { PriorPrs, type PriorPrsProps } from "./PriorPrs";

afterEach(cleanup);

const M = messages;
const REPO_ID = "11d52dbe-9081-4be3-b476-8c80077e98c6";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const ANSWER: PrPriorPrs = {
  pr_id: "pr-1",
  prs: [
    {
      id: "pr-15",
      number: 15,
      title: "Feat/pr5 cost tracking",
      author: "octocat",
      updated_at: ago(11),
      opened_at: ago(13),
      shared_files: ["src/middleware/ratelimit.ts"],
      shared_file_count: 1,
    },
    {
      id: "pr-12",
      number: 12,
      title: "Feature/analytics dashboard page skeleton",
      author: "hubot",
      updated_at: ago(70),
      opened_at: ago(72),
      shared_files: ["src/middleware/ratelimit.ts", "src/api/public/index.ts"],
      shared_file_count: 2,
    },
  ],
  total: 2,
  truncated: false,
  coverage: { with_file_lists: 6, total: 6 },
  status: "ok",
  reason: null,
};

function mount(over: Partial<PriorPrsProps> = {}) {
  const props: PriorPrsProps = {
    data: ANSWER,
    isLoading: false,
    error: null,
    repoId: REPO_ID,
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: M }}>
      <PriorPrs {...props} />
    </NextIntlClientProvider>,
  );
}

/** An answer with no rows, parameterised by the state under test. */
function emptyAnswer(over: Partial<PrPriorPrs> = {}): PrPriorPrs {
  return { ...ANSWER, prs: [], total: 0, truncated: false, ...over };
}

describe("PriorPrs", () => {
  it("lists each earlier PR by number, title and age", () => {
    mount();

    expect(screen.getByText(M.prior.label)).toBeInTheDocument();
    expect(screen.getByText("#15")).toBeInTheDocument();
    expect(screen.getByText("Feat/pr5 cost tracking")).toBeInTheDocument();
    expect(screen.getByText("11d ago")).toBeInTheDocument();
    // 70 days reads as months, not as "70d" — the unit the history actually needs.
    expect(screen.getByText("2mo ago")).toBeInTheDocument();
  });

  it("links each row to that pull request in the studio", () => {
    mount();

    const link = screen.getByRole("link", { name: /Feat\/pr5 cost tracking/ });
    expect(link).toHaveAttribute("href", `/repos/${REPO_ID}/pulls/15`);
  });

  it("still renders the rows when there is no repository to link to", () => {
    mount({ repoId: null });

    expect(screen.getByText("Feat/pr5 cost tracking")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("carries the shared paths as the row's evidence", () => {
    mount();

    const link = screen.getByRole("link", { name: /analytics dashboard/ });
    expect(link).toHaveAttribute(
      "title",
      expect.stringContaining("src/middleware/ratelimit.ts, src/api/public/index.ts"),
    );
  });

  it("collapses and re-expands the list", () => {
    mount();
    const toggle = screen.getByRole("button", { expanded: true });

    fireEvent.click(toggle);

    expect(screen.queryByText("#15")).not.toBeInTheDocument();
    // The count stays visible while collapsed — that is what makes it a summary.
    expect(screen.getByText("2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("#15")).toBeInTheDocument();
  });

  it("says the list was cut rather than presenting the top ten as all of it", () => {
    mount({ data: { ...ANSWER, truncated: true, total: 14 } });

    expect(screen.getByText(M.prior.truncated.replace("{shown}", "2").replace("{total}", "14")))
      .toBeInTheDocument();
  });

  describe("an empty list always says which empty it is", () => {
    it("states plainly that nothing else touched these files", () => {
      mount({ data: emptyAnswer({ status: "ok", reason: null }) });

      expect(screen.getByText(M.prior.none)).toBeInTheDocument();
    });

    it("says the PR's own files were never imported", () => {
      mount({
        data: emptyAnswer({ status: "degraded", reason: "no_changed_files" }),
      });

      expect(screen.getByText(M.prior.degraded.noChangedFiles)).toBeInTheDocument();
      // The "nothing else touched these files" finding must NOT also appear — that
      // is exactly the false claim this block exists to avoid.
      expect(screen.queryByText(M.prior.none)).not.toBeInTheDocument();
    });

    it("says nothing could be compared when no other PR has a file list", () => {
      mount({
        data: emptyAnswer({
          status: "degraded",
          reason: "no_file_lists",
          coverage: { with_file_lists: 1, total: 9 },
        }),
      });

      expect(screen.getByText(M.prior.degraded.noFileLists)).toBeInTheDocument();
      expect(screen.queryByText(M.prior.none)).not.toBeInTheDocument();
    });

    it("qualifies a real list when only some file lists were imported", () => {
      mount({
        data: {
          ...ANSWER,
          status: "partial",
          reason: "incomplete_file_lists",
          coverage: { with_file_lists: 4, total: 9 },
        },
      });

      expect(
        screen.getByText(
          M.prior.partial.replace("{searched}", "4").replace("{total}", "9"),
        ),
      ).toBeInTheDocument();
      // A caveat OVER real data, not instead of it.
      expect(screen.getByText("#15")).toBeInTheDocument();
    });
  });

  it("shows a skeleton while the history is being read", () => {
    const { container } = mount({ data: null, isLoading: true });

    expect(container.getElementsByClassName("skeleton").length).toBe(1);
    expect(screen.queryByText(M.prior.label)).not.toBeInTheDocument();
  });

  it("reports an unreadable history without touching the map above it", () => {
    mount({ data: null, isLoading: false, error: new Error("boom") });

    expect(screen.getByText(M.prior.error)).toBeInTheDocument();
    expect(screen.queryByText(M.prior.none)).not.toBeInTheDocument();
  });
});
