/* The agent editor's Context tab.

   Mocked at the NETWORK boundary (`fetch`) rather than at the hooks, for the
   reason `src/lib/hooks/intent.test.tsx` exists: a replace-all write that sends
   only the path just toggled resolves 200 and invalidates exactly like a
   correct one, so the only thing that catches it is asserting the outgoing
   REQUEST. AC-39 and AC-40 are both assertions about a request body.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every
   other test file in `src/`.

   The tree reads TWO namespaces: `agents` for the tab strip and `context` for
   the tab's own copy (`skills` joins them only because switching panels renders
   the Skills tab). Mounting with one of them missing does not fail — next-intl
   renders the key path and logs `IntlError: MISSING_MESSAGE` while the run
   stays green — so all three are provided, and every expected string is taken
   from the imported catalogue rather than retyped. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Agent,
  AgentSkillLink,
  ContextAttachment,
  ProjectDoc,
  ProjectDocList,
  Repo,
  SkillWithUsage,
} from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import { RepoProvider } from "@/lib/repo-context";
import { AgentEditor } from "../../AgentEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // The agent editor is not a repo-scoped route, so the active repository comes
  // from the shell's fallback — the first repo the workspace lists.
  usePathname: () => "/agents/ag1",
  useSearchParams: () => new URLSearchParams(),
}));

const REPO = "11111111-1111-4111-8111-111111111111";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
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

/** Seven discovered documents — the denominator AC-41's badge reports. */
const DOCS: ProjectDoc[] = [
  doc("docs/architecture.md", "docs/", 100),
  doc("docs/legacy.md", "docs/", 40),
  doc("docs/rubric.md", "docs/", 250),
  doc("specs/one.md", "specs/", 10),
  doc("specs/public-api.md", "specs/", 50),
  doc("specs/security-baseline.md", "specs/", 300),
  doc("specs/two.md", "specs/", 20),
];

const LIST: ProjectDocList = {
  docs: DOCS,
  roots: ["specs/", "docs/", "insights/"],
  total: 7,
  truncated: false,
  status: "ok",
  reason: null,
};

const skill = (id: string, name: string, enabled: boolean): SkillWithUsage => ({
  id,
  name,
  description: "",
  type: "custom",
  source: "manual",
  body: "",
  enabled,
  version: 1,
  evidence_files: null,
  usage: { used_by: 0, pull_rate: null, accept_rate: null, findings_30d: 0 },
});

const SKILLS: SkillWithUsage[] = [
  skill("sk-1", "House rubric", true),
  // Linked but DISABLED: it contributes nothing to a run, so its document must
  // not appear as inherited.
  skill("sk-2", "Legacy rules", false),
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "sk-1", order: 0 },
  { agent_id: "ag1", skill_id: "sk-2", order: 1 },
];

const INITIAL_ATTACHED = ["specs/public-api.md", "docs/architecture.md"];

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

const toggleLabel = (path: string) => msg(contextMessages.agentTab.toggle, { path });
const handleLabel = (path: string) => msg(contextMessages.agentTab.dragHandle, { path });
const moveUpLabel = (path: string) => msg(contextMessages.agentTab.moveUp, { path });

let attachments: ContextAttachment[];
let posts: { url: string; body: { repo_id: string; paths: string[] } }[];
const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` reads only `ok`, `status` and `json()`. */
const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let qc: QueryClient;

function tree(tab: string) {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ agents: agentsMessages, context: contextMessages, skills: skillsMessages }}
      >
        <RepoProvider>
          <AgentEditor agent={AGENT} tab={tab} onTab={() => {}} />
        </RepoProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  attachments = INITIAL_ATTACHED.map((path, order) => ({ repo_id: REPO, path, order }));
  posts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "POST" && path === "/agents/ag1/context") {
      const body = JSON.parse(String(init.body)) as { repo_id: string; paths: string[] };
      posts.push({ url: path, body });
      attachments = body.paths.map((p, order) => ({ repo_id: body.repo_id, path: p, order }));
      return jsonOk(attachments);
    }
    if (path === "/repos") return jsonOk([REPO_ROW]);
    if (path === `/repos/${REPO}/context`) return jsonOk(LIST);
    if (path === "/agents/ag1/context") return jsonOk(attachments);
    if (path === "/agents/ag1/skills") return jsonOk(LINKS);
    if (path === "/skills") return jsonOk(SKILLS);
    if (path === "/skills/sk-1/context")
      return jsonOk([{ repo_id: REPO, path: "docs/rubric.md", order: 0 }]);
    if (path === "/skills/sk-2/context")
      return jsonOk([{ repo_id: REPO, path: "docs/legacy.md", order: 0 }]);
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
const settled = () => screen.findByRole("checkbox", { name: toggleLabel("specs/one.md") });

describe("AgentEditor — Context tab", () => {
  it("renders beside Config and Skills, switches the panel, and reports the attached set", async () => {
    // AC-38, AC-41, AC-42, AC-43.
    const view = render(tree("skills"));

    // The tab strip carries all three labels whichever panel is showing.
    expect(screen.getByText(agentsMessages.editor.tabs.config)).toBeInTheDocument();
    expect(screen.getByText(agentsMessages.editor.tabs.skills)).toBeInTheDocument();
    expect(screen.getByText(agentsMessages.editor.tabs.context)).toBeInTheDocument();
    // …but the Context panel is not mounted until it is the selected tab.
    expect(screen.queryByText(contextMessages.agentTab.heading)).not.toBeInTheDocument();

    view.rerender(tree("context"));
    expect(await screen.findByText(contextMessages.agentTab.heading)).toBeInTheDocument();
    await settled();

    // AC-41 — attached out of discovered: 2 of the agent's own, 7 found.
    expect(
      screen.getByText(msg(contextMessages.agentTab.badge, { attached: 2, discovered: 7 })),
    ).toBeInTheDocument();

    // AC-42 — the combined total covers the EFFECTIVE set: the agent's two
    // (50 + 100) plus the enabled skill's inherited one (250).
    expect(
      screen.getByText(msg(contextMessages.agentTab.tokenTotal, { tokens: 400 })),
    ).toBeInTheDocument();

    // AC-43 — each row carries its own figure.
    expect(within(rowFor("specs/security-baseline.md")).getByText("300 tok")).toBeInTheDocument();
    expect(within(rowFor("specs/public-api.md")).getByText("50 tok")).toBeInTheDocument();
  });

  it("sends every attached path when one row is toggled, and moves the total with it", async () => {
    // AC-39, AC-42. The trap: a body carrying only the toggled path detaches
    // everything else, with a 200 and a successful invalidation to say so.
    render(tree("context"));
    await settled();

    fireEvent.click(
      screen.getByRole("checkbox", { name: toggleLabel("specs/security-baseline.md") }),
    );

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toEqual({
      repo_id: REPO,
      paths: [...INITIAL_ATTACHED, "specs/security-baseline.md"],
    });

    // The total is derived during render, so the new 300 lands with the refetch
    // and without a reload: 400 → 700.
    expect(
      await screen.findByText(msg(contextMessages.agentTab.tokenTotal, { tokens: 700 })),
    ).toBeInTheDocument();
  });

  it("sends the new order after a real dragstart → dragover → drop sequence", async () => {
    // AC-40. Driving the pure reorder helper would not satisfy this: the bug it
    // guards against is a drag source held in state, where every handler runs
    // before React commits and the drop silently does nothing.
    render(tree("context"));
    await settled();

    const first = rowFor("specs/public-api.md");
    const second = rowFor("docs/architecture.md");

    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.paths).toEqual(["docs/architecture.md", "specs/public-api.md"]);
    expect(posts[0]!.body.paths).not.toEqual(INITIAL_ATTACHED);

    // …and re-reading returns it.
    await waitFor(() =>
      expect(rowPaths().slice(0, 2)).toEqual(["docs/architecture.md", "specs/public-api.md"]),
    );
  });

  it("shows a skill's documents in effective order, labelled, with nothing to toggle or drag", async () => {
    // AC-45. Also the disabled-skill half: a linked skill that is off
    // contributes nothing to a run, so its document must not read as inherited.
    render(tree("context"));
    await settled();

    const inherited = rowFor("docs/rubric.md");
    expect(
      within(inherited).getByText(msg(contextMessages.agentTab.inherited, { skill: "House rubric" })),
    ).toBeInTheDocument();
    expect(within(inherited).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(inherited).queryByRole("button")).not.toBeInTheDocument();

    // Effective order: the agent's own two first, then the skill's.
    expect(rowPaths().slice(0, 3)).toEqual([
      "specs/public-api.md",
      "docs/architecture.md",
      "docs/rubric.md",
    ]);

    // The disabled skill's document is a plain, attachable row — not inherited.
    const legacy = rowFor("docs/legacy.md");
    expect(within(legacy).getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    expect(within(legacy).queryByText(/House rubric|Legacy rules/)).not.toBeInTheDocument();
  });

  it("attaches a document and moves it one position up without a pointer", async () => {
    // AC-47. Every row control is a real focusable button with an accessible
    // name, and the reorder — the part with no native keyboard equivalent — is
    // driven by a genuine keydown, never a click.
    render(tree("context"));
    await settled();

    const checkbox = screen.getByRole("checkbox", { name: toggleLabel("specs/two.md") });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    expect(checkbox).toHaveTextContent(""); // icon-only: the name is the label
    // jsdom does not synthesize the click a browser dispatches for Enter on a
    // focused <button>, and `user-event` — which models that — is not available
    // here. The focus assertion above is the part AC-47 turns on: this is a real
    // button in the tab order, not a div with an onClick.
    fireEvent.keyDown(checkbox, { key: "Enter", code: "Enter" });
    fireEvent.click(checkbox, { detail: 0 });

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.paths).toEqual([...INITIAL_ATTACHED, "specs/two.md"]);

    // Now reorder it, from the keyboard only.
    const handle = await screen.findByRole("button", { name: handleLabel("specs/two.md") });
    handle.focus();
    expect(handle).toHaveFocus();
    fireEvent.keyDown(handle, { key: "ArrowUp", code: "ArrowUp" });

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body.paths).toEqual([
      "specs/public-api.md",
      "specs/two.md",
      "docs/architecture.md",
    ]);

    // The same move is also a worded, focusable button, for a reader who tabs
    // rather than learning an arrow convention.
    expect(screen.getByRole("button", { name: moveUpLabel("specs/two.md") })).toBeEnabled();
  });
});
