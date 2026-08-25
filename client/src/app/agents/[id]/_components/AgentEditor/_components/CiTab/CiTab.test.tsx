/* The agent editor's CI tab, and the four-step export wizard inside it.

   Mocked at the NETWORK boundary (`fetch`) rather than at the hooks, matching
   `EvalsTab.test.tsx` and `src/lib/hooks/ci.test.tsx`: the hooks under test here
   are the real ones, so a path or a query key that drifts shows up as a region
   that never leaves its skeleton instead of as a green run.

   TWO namespaces are provided, `ci` and `agents`, because the tab composes a
   shared unit: the gate section reuses `agents.config.ciFailOnOptions.*` rather
   than forking those four labels into `ci.json`. Mounting with one missing does
   NOT fail — next-intl renders the key path and logs `IntlError: MISSING_MESSAGE`
   while the assertion passes (`client/INSIGHTS.md`, 2026-08-11) — so both are
   given, and every expected string is read out of the imported catalogue rather
   than retyped.

   `@testing-library/user-event` is NOT a dependency of this package — importing
   it fails at collect time — so interaction is `fireEvent`, matching every other
   test file in `src/`. There is no shared QueryClient helper either; one is built
   inline per test, as `AgentCard.test.tsx` does.

   No `EventSource` stub is needed and that is the point: this feature adds no
   SSE hook. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiExport, CiExportPreview, CiInstallation, Repo } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import { CiTab } from "./CiTab";
import { CI_MODEL_KEY_ENV } from "./constants";

/** Stored as `warning`, so the gate section has a value that is not the default. */
const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "warning",
  repo_intel: true,
  enabled: true,
  version: 3,
};

const REPO: Repo = {
  id: "re1",
  workspace_id: "ws1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/tmp/acme",
  last_polled_at: null,
  created_by: null,
};

const install = (over: Partial<CiInstallation> & { id: string; repo: string }): CiInstallation => ({
  agent_id: "ag1",
  target_type: "gha",
  installed_at: "2026-08-20T10:00:00.000Z",
  last_run_status: null,
  last_run_at: null,
  ...over,
});

/** Four minutes ago, so `formatAge` renders a stable "4m". */
const FOUR_MIN_AGO = new Date(Date.now() - 4 * 60_000).toISOString();

const INSTALLS: CiInstallation[] = [
  install({
    id: "ins1",
    repo: "acme/payments-api",
    last_run_status: "succeeded",
    last_run_at: FOUR_MIN_AGO,
  }),
  // Installed, never run — the ordinary first state, and it must say so rather
  // than render a blank cell.
  install({ id: "ins2", repo: "acme/billing" }),
];

const PREVIEW: CiExportPreview = {
  files: [
    {
      path: ".github/workflows/devdigest-review.yml",
      contents: "name: DevDigest review\npermissions:\n  contents: read\n",
      editable: false,
    },
    {
      path: ".devdigest/agents/security-reviewer.yaml",
      contents: "name: Security Reviewer\nci_fail_on: warning\n",
      editable: false,
    },
    { path: ".devdigest/skills/secret-gate.md", contents: "# Secret gate\n", editable: false },
    { path: ".devdigest/runner.mjs", contents: "// bundled runner\n", editable: false },
  ],
};

const EXPORTED: CiExport = {
  installation: INSTALLS[0]!,
  files: PREVIEW.files,
  pr_url: "https://github.com/acme/payments-api/pull/7",
};

/** Copy, taken from the catalogue so the i18n boundary is not re-forked here. */
const msg = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), template);

/**
 * An ICU plural message rendered for `count`, read out of the catalogue.
 *
 * `msg` above cannot render a plural, and retyping the English would fork the
 * copy this file is careful not to fork — so the `other` branch is substituted
 * back into the surrounding sentence instead.
 */
const plural = (template: string, count: number) => {
  const branch = (/other \{([^}]*)\}/.exec(template)?.[1] ?? "").replace("#", String(count));
  return template.replace(/\{\s*\w+\s*,\s*plural\s*,[\s\S]*\}/, branch);
};

// ---------------------------------------------------------------------------

type Route = { status: number; body: unknown } | "pending";

let routes: Map<string, Route>;
let posts: { path: string; body: unknown }[];
const fetchMock = vi.fn();
let qc: QueryClient;

const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body }) as
    unknown as Response;

const okRoutes = (): Map<string, Route> =>
  new Map<string, Route>([
    ["/repos", { status: 200, body: [REPO] }],
    ["/agents/ag1/ci-installations", { status: 200, body: INSTALLS }],
    ["POST /agents/ag1/export-ci/preview", { status: 200, body: PREVIEW }],
    ["POST /agents/ag1/export-ci", { status: 200, body: EXPORTED }],
  ]);

beforeEach(() => {
  routes = okRoutes();
  posts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = init?.method === "POST" ? `POST ${path}` : path;
    if (init?.method === "POST") posts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    const route = routes.get(key);
    // A route registered as `pending` never resolves — that is how a loading
    // state is held open long enough to assert.
    if (route === "pending") return new Promise<Response>(() => {});
    if (route) return jsonRes(route.status, route.body);
    return jsonRes(200, []);
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

function renderTab() {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, agents: agentsMessages }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const repoField = () =>
  screen.getByRole("textbox", { name: ciMessages.exportWizard.repoLabel }) as HTMLInputElement;
const continueBtn = () => screen.getByRole("button", { name: ciMessages.exportWizard.continue });
const backBtn = () => screen.getByRole("button", { name: ciMessages.exportWizard.back });

/** Open the wizard from the add-a-repository row and fill in a valid repository. */
async function openWizardWithRepo(repo = "acme/payments-api") {
  fireEvent.click(await screen.findByRole("button", { name: ciMessages.ciTab.addRepo }));
  fireEvent.change(repoField(), { target: { value: repo } });
}

describe("AgentEditor — CI tab", () => {
  it("offers no export entry at all when the workspace has no repository", async () => {
    // AC-47. A disabled control would be a promise with no date; there is none.
    routes.set("/repos", { status: 200, body: [] });
    renderTab();

    expect(await screen.findByText(ciMessages.ciTab.noRepo)).toBeInTheDocument();
    expect(screen.getByText(ciMessages.ciTab.noRepoBody)).toBeInTheDocument();

    for (const label of [
      ciMessages.ciTab.exportToCi,
      ciMessages.ciTab.update,
      ciMessages.ciTab.addRepo,
    ]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("lists each installation with its latest run's status and age, counts them, and shows the gate read-only", async () => {
    // AC-48, AC-49, AC-50.
    renderTab();

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("acme/payments-api")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("acme/billing")).toBeInTheDocument();

    // The status is a WORD (beside a dot), never a colour alone — and the age is
    // the LAST RUN's, not the install date.
    expect(within(rows[0]!).getByText(ciMessages.runs.status.succeeded)).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(msg(ciMessages.ciTab.ranAgo, { age: "4m" })),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByText(ciMessages.exportWizard.targets.gha)).toBeInTheDocument();

    // Installed and never run says so, rather than rendering a blank cell.
    expect(within(rows[1]!).getByText(ciMessages.ciTab.neverRun)).toBeInTheDocument();

    // N13 — the rows are a plain list: no edit and no delete control on any of
    // them. Asserted as "no control at all", which cannot be satisfied by
    // renaming one.
    for (const row of rows) expect(within(row).queryAllByRole("button")).toHaveLength(0);

    expect(screen.getByText(plural(ciMessages.ciTab.activeIn, 2))).toBeInTheDocument();

    // AC-50 — the stored `warning` renders the label ALREADY authored under the
    // `agents` namespace, and AC-49 — nothing here writes the field: the tab
    // renders no select at all.
    expect(
      screen.getByText(agentsMessages.config.ciFailOnOptions.warning),
    ).toBeInTheDocument();
    expect(screen.getByText(ciMessages.ciTab.gateBody)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the empty state with no installations, and the add row opens a wizard gated on owner/name", async () => {
    // AC-48 (none), AC-51, AC-52, AC-53.
    routes.set("/agents/ag1/ci-installations", { status: 200, body: [] });
    renderTab();

    expect(await screen.findByText(ciMessages.ciTab.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ciMessages.ciTab.addRepo }));

    const dialog = screen.getByRole("dialog");
    // AC-51 — exactly four steps, in order.
    expect(
      Object.values(ciMessages.exportWizard.steps).map((l) =>
        within(dialog).getByText(l).textContent,
      ),
    ).toEqual(["Target", "Preview", "Configure", "Install"]);

    // AC-52 — GitHub Actions is the only target offered. One card, not four with
    // three disabled.
    const targets = within(dialog).getAllByRole("radio");
    expect(targets).toHaveLength(1);
    const targetTitle = within(targets[0]!).getByText(ciMessages.exportWizard.targets.gha);
    expect(targetTitle).toBeInTheDocument();

    // AC-65 — the four step labels and the target card's title declare
    // `var(--text-primary)`. Asserted on the LITERAL token because an unknown
    // custom property is not a CSS error: the declaration silently drops and the
    // element just inherits (`client/INSIGHTS.md`, 2026-08-06). All four labels
    // carry it, including the steps the user has not reached — dimming one is
    // the vendored `ExportWizardSteps`' decision this screen cannot take.
    for (const label of Object.values(ciMessages.exportWizard.steps)) {
      expect(within(dialog).getByText(label)).toHaveStyle({ color: "var(--text-primary)" });
    }
    expect(targetTitle).toHaveStyle({ color: "var(--text-primary)" });

    // AC-53 — Continue stays disabled until the field matches `owner/name`.
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(repoField(), { target: { value: "acme" } });
    expect(continueBtn()).toBeDisabled();
    fireEvent.change(repoField(), { target: { value: "acme/payments-api" } });
    expect(continueBtn()).toBeEnabled();
  });

  it("pre-fills the repository from the update entry, and renders a preview failure inline without losing it", async () => {
    // N12 (update is the same path, one field answered), AC-55, AC-56.
    routes.set("POST /agents/ag1/export-ci/preview", "pending");
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: ciMessages.ciTab.update }));
    expect(repoField()).toHaveValue("acme/payments-api");

    // AC-55 — while the preview is generating, the copy says so and Continue is
    // held disabled.
    fireEvent.click(continueBtn());
    expect(await screen.findByText(ciMessages.exportWizard.generating)).toBeInTheDocument();
    expect(continueBtn()).toBeDisabled();

    // AC-56 — the failure renders inline on the Preview step…
    routes.set("POST /agents/ag1/export-ci/preview", {
      status: 500,
      body: { error: { code: "github_error", message: "repository not found" } },
    });
    fireEvent.click(backBtn());
    fireEvent.click(continueBtn());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(ciMessages.exportWizard.previewFailed)).toBeInTheDocument();
    expect(within(alert).getByText("repository not found")).toBeInTheDocument();
    expect(continueBtn()).toBeDisabled();

    // …and returning to Target shows the repository still filled in.
    fireEvent.click(backBtn());
    expect(repoField()).toHaveValue("acme/payments-api");
  });

  it("walks Preview → Configure → Install and opens the pull request", async () => {
    // AC-54, AC-57, AC-58, AC-59, AC-60.
    renderTab();
    await openWizardWithRepo();
    fireEvent.click(continueBtn());

    // AC-54 — every generated file listed by path, in a fixed order.
    const paths = PREVIEW.files.map((f) => f.path);
    for (const path of paths) expect(await screen.findByText(path)).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    const listed = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(listed.map((text) => paths.find((p) => text.startsWith(p)))).toEqual(paths);

    // …viewable, and NOT editable: no input and no editor for any file, and the
    // mock's "editable" chip is not shipped.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${paths[0]}`) }));
    // Read off the node rather than through a text query: the accessible-name
    // and text-matching normalisation collapses the newlines and the runs of
    // spaces that a YAML file is made of, so only `textContent` can assert the
    // contents VERBATIM (`client/INSIGHTS.md`, 2026-08-19).
    expect(dialog.querySelector("pre")?.textContent).toBe(PREVIEW.files[0]!.contents);
    expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
    expect(dialog.querySelectorAll("textarea")).toHaveLength(0);
    expect(within(dialog).getByText(ciMessages.exportWizard.readOnly)).toBeInTheDocument();
    expect(within(dialog).queryByText(ciMessages.exportWizard.editable)).not.toBeInTheDocument();

    // AC-57 — the two controls open on the CONTRACT's defaults.
    fireEvent.click(continueBtn());
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    expect(screen.getByRole("combobox")).toHaveValue("github_review");

    // AC-58 — the sentence about making the check REQUIRED, and no claim that a
    // GitHub App is needed (the stale string this feature replaced).
    expect(screen.getByText(ciMessages.exportWizard.blockMergeDesc)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("GitHub App");

    // AC-59 — the heading, the count, the repository and the secret note.
    fireEvent.click(continueBtn());
    const installHeading = screen.getByText(ciMessages.exportWizard.installCardTitle);
    expect(installHeading).toBeInTheDocument();
    // AC-65, the third element it names.
    expect(installHeading).toHaveStyle({ color: "var(--text-primary)" });
    expect(
      screen.getByText(
        msg(ciMessages.exportWizard.installCardBody, {
          repo: "acme/payments-api",
          count: PREVIEW.files.length,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(msg(ciMessages.exportWizard.secretNote, { key: CI_MODEL_KEY_ENV })),
    ).toBeInTheDocument();

    // AC-60 — the link to the opened (or reused) pull request.
    fireEvent.click(screen.getByRole("button", { name: ciMessages.exportWizard.install }));
    expect(await screen.findByText(ciMessages.exportWizard.installedTitle)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ciMessages.exportWizard.viewPr })).toHaveAttribute(
      "href",
      EXPORTED.pr_url,
    );
    expect(posts.at(-1)?.path).toBe("/agents/ag1/export-ci");
  });

  it("renders the server's message on a failed install and keeps every value the user entered", async () => {
    // AC-61.
    routes.set("POST /agents/ag1/export-ci", {
      status: 403,
      body: { error: { code: "github_permission", message: "missing `contents: write`" } },
    });
    renderTab();
    await openWizardWithRepo();
    fireEvent.click(continueBtn());
    await screen.findByText(PREVIEW.files[0]!.path);

    fireEvent.click(continueBtn());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pr_comment" } });
    fireEvent.click(continueBtn());
    fireEvent.click(screen.getByRole("button", { name: ciMessages.exportWizard.install }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(ciMessages.exportWizard.installFailed)).toBeInTheDocument();
    expect(within(alert).getByText("missing `contents: write`")).toBeInTheDocument();

    // Nothing the user chose was thrown away by the failure.
    fireEvent.click(backBtn());
    expect(screen.getByRole("combobox")).toHaveValue("pr_comment");
    fireEvent.click(backBtn());
    fireEvent.click(backBtn());
    expect(repoField()).toHaveValue("acme/payments-api");
    await waitFor(() => expect(posts.some((p) => p.path === "/agents/ag1/export-ci")).toBe(true));
  });
});
