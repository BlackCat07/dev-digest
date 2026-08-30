/* The Export-to-CI hooks — asserted at the REQUEST boundary.

   Mocked at `fetch` and not at `api`/`apiFetch`, because the failure this file
   exists for is only visible in the outgoing body: a mutation that omits an
   optional field is a silently successful no-op — the server applies its own
   default, answers 200, the mutation resolves and invalidates, and the wizard
   reports an install configured the way the user did not choose
   (`client/INSIGHTS.md`, 2026-08-11). Asserting the RESPONSE cannot see it.

   No shared QueryClient helper exists in this package (each file builds one
   inline), and `@testing-library/user-event` is not a dependency here — neither
   is needed for a hook test, but both are why this file looks like its
   neighbours rather than like the RTL docs. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiExport, CiExportPreview, CiInstallation, CiRun } from "@devdigest/shared";
import { CI_DEFAULT_BASE, CI_DEFAULT_POST_AS, CI_DEFAULT_TARGET, CI_DEFAULT_TRIGGERS } from "../ci";
import {
  useAgentCiInstallations,
  useCiPreview,
  useCiRuns,
  useExportToCi,
  useRefreshCiRuns,
} from "./ci";

const FILES: CiExportPreview = {
  files: [
    { path: ".github/workflows/devdigest-review.yml", contents: "name: DevDigest\n", editable: false },
    { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security\n", editable: false },
  ],
};

const INSTALLATION: CiInstallation = {
  id: "ins1",
  agent_id: "ag1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2026-08-20T10:00:00.000Z",
  last_run_status: "succeeded",
  last_run_at: "2026-08-20T10:30:00.000Z",
};

const EXPORTED: CiExport = {
  installation: INSTALLATION,
  files: FILES.files,
  pr_url: "https://github.com/acme/payments-api/pull/7",
};

const RUN: CiRun = {
  id: "r1",
  ci_installation_id: "ins1",
  pr_number: 7,
  ran_at: "2026-08-20T10:30:00.000Z",
  status: "succeeded",
  findings_count: 2,
  cost_usd: 0.004,
  github_url: "https://github.com/acme/payments-api/actions/runs/1",
  source: "ci",
  agent: "Security Reviewer",
  duration_s: 42,
  repo: "acme/payments-api",
  head_sha: "abc1234",
  blockers: 0,
  reason: null,
};

const fetchMock = vi.fn();
let calls: { path: string; init: RequestInit | undefined }[];
let qc: QueryClient;

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "", json: async () => body }) as unknown as Response;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** The parsed body of the one POST made to `path`. */
const bodyOf = (path: string) => {
  const call = calls.find((c) => c.path === path && c.init?.method === "POST");
  expect(call, `no POST to ${path}`).toBeDefined();
  return call!.init!.body ? JSON.parse(String(call!.init!.body)) : null;
};

beforeEach(() => {
  calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ path, init });
    if (path.endsWith("/export-ci/preview")) return jsonOk(FILES);
    if (path.endsWith("/export-ci")) return jsonOk(EXPORTED);
    if (path.endsWith("/ci-installations")) return jsonOk([INSTALLATION]);
    if (path === "/ci-runs/refresh") return jsonOk([RUN]);
    if (path === "/ci-runs") return jsonOk([RUN]);
    return jsonOk([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  qc.clear();
  vi.unstubAllGlobals();
});

describe("useCiPreview / useExportToCi", () => {
  it("puts EVERY export field on the wire, with the preview differing only in path and action", async () => {
    const { result } = renderHook(
      () => ({ preview: useCiPreview(), install: useExportToCi() }),
      { wrapper },
    );

    act(() => {
      result.current.preview.mutate({ agentId: "ag1", repo: "acme/payments-api" });
    });
    await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));

    // The whole `CiExportInput` shape, defaults included. A field left OFF here
    // is the no-op this suite exists for — the server would default it, answer
    // 200, and nothing downstream would ever disagree.
    expect(bodyOf("/agents/ag1/export-ci/preview")).toEqual({
      repo: "acme/payments-api",
      target: CI_DEFAULT_TARGET,
      action: "files",
      post_as: CI_DEFAULT_POST_AS,
      triggers: [...CI_DEFAULT_TRIGGERS],
      base: CI_DEFAULT_BASE,
    });
    // A preview performs no write: it is the only call made.
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);

    act(() => {
      result.current.install.mutate({
        agentId: "ag1",
        repo: "acme/payments-api",
        post_as: "pr_comment",
        triggers: ["opened"],
      });
    });
    await waitFor(() => expect(result.current.install.isSuccess).toBe(true));

    // Same shape, one path along, and the user's two choices carried through.
    expect(bodyOf("/agents/ag1/export-ci")).toEqual({
      repo: "acme/payments-api",
      target: CI_DEFAULT_TARGET,
      action: "open_pr",
      post_as: "pr_comment",
      triggers: ["opened"],
      base: CI_DEFAULT_BASE,
    });
    expect(result.current.install.data?.pr_url).toContain("/pull/7");
  });
});

describe("useAgentCiInstallations / useCiRuns / useRefreshCiRuns", () => {
  it("reads one installation list per agent and refreshes runs with no body at all", async () => {
    const { result } = renderHook(
      () => ({
        installs: useAgentCiInstallations("ag1"),
        idle: useAgentCiInstallations(null),
        runs: useCiRuns(),
        refresh: useRefreshCiRuns(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.installs.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.runs.isSuccess).toBe(true));

    // One request, for the agent that exists. The disabled hook never fires one.
    expect(calls.filter((c) => c.path.endsWith("/ci-installations"))).toHaveLength(1);
    expect(result.current.idle.fetchStatus).toBe("idle");
    // `last_run_status` / `last_run_at` arrive on the installation itself — the
    // tab does not fan out a run query per row.
    expect(result.current.installs.data?.[0]?.last_run_status).toBe("succeeded");

    act(() => {
      result.current.refresh.mutate();
    });
    await waitFor(() => expect(result.current.refresh.isSuccess).toBe(true));

    // NO body, which is what keeps `content-type` off the request: `apiFetch`
    // only declares JSON when a body is actually sent, and the header without a
    // body trips Fastify's "Body cannot be empty when content-type is
    // application/json".
    const refresh = calls.find((c) => c.path === "/ci-runs/refresh");
    expect(refresh?.init?.body).toBeUndefined();
    expect(refresh?.init?.headers).not.toHaveProperty("content-type");
    // The refreshed rows are written straight into the runs cache.
    expect(qc.getQueryData<CiRun[]>(["ci-runs"])?.[0]?.id).toBe("r1");
  });
});
