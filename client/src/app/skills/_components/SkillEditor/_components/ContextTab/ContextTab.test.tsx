/* The skill editor's Context tab.

   Mocked at the NETWORK boundary (`fetch`) rather than at the hooks, for the
   reason `src/lib/hooks/intent.test.tsx` exists: a replace-all write that sends
   only the path just toggled resolves 200 and invalidates exactly like a
   correct one, so the only thing that catches it is asserting the outgoing
   REQUEST.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every
   other test file in `src/`.

   The tree reads TWO namespaces: `skills` for the tab strip and `context` for
   the tab's own copy. Mounting with one of them missing does not fail —
   next-intl renders the key path and logs `IntlError: MISSING_MESSAGE` while
   the run stays green — so both are provided, and every expected string is
   taken from the imported catalogue rather than retyped. That is the point of
   AC-44 and AC-46: the heading and the block label are pinned to the copy the
   feature actually ships, not to a literal that can drift from it. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ContextAttachment,
  ProjectDoc,
  ProjectDocList,
  Repo,
  SkillWithUsage,
} from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import { RepoProvider } from "@/lib/repo-context";

/** `?tab=` is read by `SkillEditor` itself, so the mock is mutable per test. */
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The skill editor is not a repo-scoped route, so the active repository comes
  // from the shell's fallback — the first repo the workspace lists.
  usePathname: () => "/skills/sk1",
  useSearchParams: () => search,
}));

// Imported AFTER the mock so the component picks it up.
const { SkillEditor } = await import("../../SkillEditor");

const REPO = "11111111-1111-4111-8111-111111111111";

const SKILL: SkillWithUsage = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "A rubric.",
  type: "rubric",
  body: "# Rubric",
  source: "manual",
  enabled: true,
  version: 3,
  evidence_files: null,
  usage: { used_by: 1, pull_rate: 0.5, accept_rate: 0.5, findings_30d: 2 },
};

const REPO_ROW: Repo = {
  id: REPO,
  workspace_id: "ws1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/tmp/clone",
  last_polled_at: null,
  created_by: null,
};

const doc = (path: string, root: string, tokens: number): ProjectDoc => ({
  path,
  doc_type: root === "specs/" ? "spec" : "doc",
  root,
  size: tokens * 4,
  tokens,
  updated_at: "2026-08-19T09:00:00.000Z",
  used_by_agents: 1,
});

const DOCS: ProjectDoc[] = [
  doc("docs/architecture.md", "docs/", 100),
  doc("specs/public-api.md", "specs/", 50),
  doc("specs/two.md", "specs/", 20),
];

const LIST: ProjectDocList = {
  docs: DOCS,
  roots: ["specs/", "docs/", "insights/"],
  total: 3,
  truncated: false,
  status: "ok",
  reason: null,
};

/** `a` then `b`, so the reorder assertion below has something to invert. */
const INITIAL_ATTACHED = ["specs/public-api.md", "docs/architecture.md"];

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

const toggleLabel = (path: string) => msg(contextMessages.skillTab.toggle, { path });
const moveUpLabel = (path: string) => msg(contextMessages.skillTab.moveUp, { path });

let attachments: ContextAttachment[];
let posts: { url: string; body: { repo_id: string; paths: string[] } }[];
const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` reads only `ok`, `status` and `json()`. */
const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let qc: QueryClient;

function tree() {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ skills: skillsMessages, context: contextMessages }}
      >
        <RepoProvider>
          <SkillEditor skill={SKILL} />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  search = new URLSearchParams();
  attachments = INITIAL_ATTACHED.map((path, order) => ({ repo_id: REPO, path, order }));
  posts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "POST" && path === "/skills/sk1/context") {
      const body = JSON.parse(String(init.body)) as { repo_id: string; paths: string[] };
      posts.push({ url: path, body });
      attachments = body.paths.map((p, order) => ({ repo_id: body.repo_id, path: p, order }));
      return jsonOk(attachments);
    }
    if (path === "/repos") return jsonOk([REPO_ROW]);
    if (path === `/repos/${REPO}/context`) return jsonOk(LIST);
    if (path === "/skills/sk1/context") return jsonOk(attachments);
    return jsonOk([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  qc.clear();
  vi.unstubAllGlobals();
});

/** The `<li>` carrying a given document path. */
const rowFor = (path: string) =>
  screen.getAllByRole("listitem").find((li) => within(li).queryByText(path))!;

const rowPaths = () =>
  screen.getAllByRole("listitem").map((li) => li.querySelector(".mono")?.textContent);

/** Wait for the tab's first paint — the skeleton is gone once a row exists. */
const settled = () => screen.findByRole("checkbox", { name: toggleLabel("specs/two.md") });

describe("SkillEditor — Context tab", () => {
  it("renders beside the other tabs, switches the panel, and is headed for project context", async () => {
    // AC-44. Mounted on Preview rather than the default Config tab: Config
    // needs the toast provider the real screen wraps it in, and this test is
    // about the strip and the panel switch, not about that form.
    search = new URLSearchParams("tab=preview");
    const view = render(tree());

    // The tab strip carries every label whichever panel is showing. Queried as
    // BUTTONS: `previewTab.title` is also the word "Preview", so plain text
    // would match the panel's own heading too.
    for (const label of Object.values(skillsMessages.tabs)) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // …but the Context panel is not mounted until it is the selected tab.
    expect(screen.queryByText(contextMessages.skillTab.heading)).not.toBeInTheDocument();

    search = new URLSearchParams("tab=context");
    view.rerender(tree());

    expect(await screen.findByText(contextMessages.skillTab.heading)).toBeInTheDocument();
    await settled();

    // 2 of the 3 discovered documents are attached.
    expect(
      screen.getByText(msg(contextMessages.skillTab.badge, { attached: 2, discovered: 3 })),
    ).toBeInTheDocument();
    expect(within(rowFor("specs/public-api.md")).getByText("50 tok")).toBeInTheDocument();
  });

  it("previews the block under the heading the engine emits", async () => {
    // AC-46. `## Project context` is what `reviewer-core/src/prompt.ts` writes;
    // the design's `## Project specifications` is the thing being corrected, and
    // asserting through the catalogue is what keeps the two from re-forking.
    search = new URLSearchParams("tab=context");
    render(tree());
    await settled();

    expect(screen.getByText(contextMessages.skillTab.previewHeading)).toBeInTheDocument();

    const block = screen.getByText(new RegExp(contextMessages.skillTab.blockLabel));
    expect(block).toHaveTextContent(contextMessages.skillTab.blockLabel);
    // The attached documents, in the order a run reads them.
    expect(block.textContent?.split("\n").filter(Boolean).slice(1)).toEqual(INITIAL_ATTACHED);
    expect(block).not.toHaveTextContent("## Project specifications");
  });

  it("sends the whole ordered set on a reorder, and re-reading returns it", async () => {
    // AC-15. The write is a replacement, so the body carries every attached
    // path — sending only the moved one would detach the rest with a 200.
    search = new URLSearchParams("tab=context");
    render(tree());
    await settled();

    const moveUp = screen.getByRole("button", { name: moveUpLabel("docs/architecture.md") });
    moveUp.focus();
    expect(moveUp).toHaveFocus();
    fireEvent.click(moveUp);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({
      repo_id: REPO,
      paths: ["docs/architecture.md", "specs/public-api.md"],
    });

    await waitFor(() =>
      expect(rowPaths().slice(0, 2)).toEqual(["docs/architecture.md", "specs/public-api.md"]),
    );
  });
});
