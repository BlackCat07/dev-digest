/* The Project Context data layer — the hooks, and the pure helpers the two
   Context tabs render from.

   Mocked at the NETWORK boundary (`fetch`) rather than at `api`/`apiFetch`,
   following `intent.test.tsx`, and for the same reason: the only thing that
   catches a replace-all mutation which omits a field is asserting the REQUEST.
   A body carrying `paths` and no `repo_id`, or carrying only the path that was
   just toggled, resolves 200 and invalidates exactly like a correct one — the
   first would be rejected by the route schema, the second would silently detach
   every other document. Neither is visible from the response.

   Stubbing `fetch` also keeps `apiFetch`'s conditional `content-type` inside the
   code path under test, which a mock of `api.post` would step over.

   No shared QueryClient test helper exists in this package, so the wrapper below
   is local, on purpose. `@testing-library/user-event` is not a dependency here;
   nothing in this file needs it — the mutations are driven through `mutate`. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextAttachment, ProjectDoc, ProjectDocList } from "@devdigest/shared";
import { ApiError } from "../api";
import {
  useProjectDocs,
  useAgentContextDocs,
  useSetAgentContextDocs,
} from "./project-context";
import { attachedTokenTotal, effectiveContextDocs } from "../context-docs";

const REPO = "11111111-1111-4111-8111-111111111111";
const OTHER_REPO = "22222222-2222-4222-8222-222222222222";

const doc = (path: string, root: string, tokens: number): ProjectDoc => ({
  path,
  doc_type: root === "specs/" ? "spec" : "doc",
  root,
  size: tokens * 4,
  tokens,
  updated_at: "2026-08-19T09:00:00.000Z",
  used_by_agents: 0,
});

const DOCS: ProjectDoc[] = [
  doc("docs/architecture.md", "docs/", 100),
  doc("specs/project-context.md", "specs/", 300),
  doc("specs/public-api.md", "specs/", 50),
];

const LIST: ProjectDocList = {
  docs: DOCS,
  roots: ["specs/", "docs/", "insights/"],
  total: 3,
  truncated: false,
  status: "ok",
  reason: null,
};

const fetchMock = vi.fn();

/** A minimal ok Response — `apiFetch` only reads `ok`, `status` and `json()`. */
const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const jsonErr = (status: number, code: string, message: string) =>
  ({
    ok: false,
    status,
    statusText: message,
    json: async () => ({ error: { code, message } }),
  }) as unknown as Response;

let qc: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  qc.clear();
  vi.unstubAllGlobals();
});

describe("useProjectDocs", () => {
  it("returns the envelope, and surfaces a failed list as an ApiError the screen can branch on", async () => {
    // AC-31's data half: the screen renders an error BESIDE the list and leaves
    // the rest of itself usable, which it can only do if the failure arrives as
    // a value on this hook rather than as a throw through the tree.
    fetchMock.mockResolvedValue(jsonOk(LIST));
    const ok = renderHook(() => useProjectDocs(REPO), { wrapper });

    await waitFor(() => expect(ok.result.current.isSuccess).toBe(true));
    expect(ok.result.current.data?.docs).toHaveLength(3);
    // The envelope, not a bare array: an empty `docs` means nothing without it.
    expect(ok.result.current.data?.status).toBe("ok");
    expect(ok.result.current.data?.roots).toEqual(["specs/", "docs/", "insights/"]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/repos/${REPO}/context`);

    qc.clear();
    fetchMock.mockResolvedValue(jsonErr(500, "internal_error", "Cannot read the clone"));
    const failed = renderHook(() => useProjectDocs(REPO), { wrapper });

    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    const err = failed.result.current.error;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).code).toBe("internal_error");
  });

  it("issues no request without a repository", async () => {
    const { result } = renderHook(() => useProjectDocs(null), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSetAgentContextDocs", () => {
  it("sends the complete ordered path array and its repository, and re-reads the new order", async () => {
    // AC-39. The trap this asserts: a toggle that sends only the path it
    // touched is a 200 that silently detaches everything else, and a body with
    // no `repo_id` would replace a set the sender never saw.
    let stored: ContextAttachment[] = [
      { repo_id: REPO, path: "specs/public-api.md", order: 0 },
      { repo_id: REPO, path: "docs/architecture.md", order: 1 },
      // A set held against a DIFFERENT repository. The write is scoped, so this
      // row must survive a replace-all sent for REPO.
      { repo_id: OTHER_REPO, path: "specs/other.md", order: 0 },
    ];

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { repo_id: string; paths: string[] };
        stored = [
          ...stored.filter((row) => row.repo_id !== body.repo_id),
          ...body.paths.map((path, order) => ({ repo_id: body.repo_id, path, order })),
        ];
        return Promise.resolve(jsonOk(stored));
      }
      return Promise.resolve(jsonOk(stored));
    });

    const { result } = renderHook(
      () => ({ list: useAgentContextDocs("agent-1"), set: useSetAgentContextDocs() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const attached = (result.current.list.data ?? [])
      .filter((row) => row.repo_id === REPO)
      .map((row) => row.path);
    expect(attached).toEqual(["specs/public-api.md", "docs/architecture.md"]);

    // Attaching ONE more document: the caller sends every path still attached.
    await act(async () => {
      await result.current.set.mutateAsync({
        agentId: "agent-1",
        repo_id: REPO,
        paths: [...attached, "specs/project-context.md"],
      });
    });

    const post = (fetchMock.mock.calls as [string, RequestInit | undefined][]).find(
      (c) => c[1]?.method === "POST",
    );
    expect(post).toBeDefined();
    expect(post![0]).toContain("/agents/agent-1/context");
    // Parsed, not the raw string, so key order can never break this.
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      repo_id: REPO,
      paths: ["specs/public-api.md", "docs/architecture.md", "specs/project-context.md"],
    });
    // A NON-EMPTY body is what makes `apiFetch`'s content-type header safe:
    // Fastify's "Body cannot be empty when content-type is application/json"
    // trips on the header WITHOUT a body.
    expect(String(post![1]!.body).length).toBeGreaterThan(0);

    // Invalidated rather than written from the response, and re-read in order.
    await waitFor(() =>
      expect(
        (result.current.list.data ?? []).filter((r) => r.repo_id === REPO).map((r) => r.path),
      ).toEqual([
        "specs/public-api.md",
        "docs/architecture.md",
        "specs/project-context.md",
      ]),
    );
    // The other repository's attachment was not touched by a scoped replace-all.
    expect((result.current.list.data ?? []).some((r) => r.repo_id === OTHER_REPO)).toBe(true);
  });
});

describe("effective set and token total", () => {
  it("merges the agent's own documents ahead of its skills', first occurrence winning", () => {
    // The order a run assembles in, mirrored client-side so an inherited row can
    // be labelled and shown in the position the prompt will carry it.
    const effective = effectiveContextDocs(
      ["specs/public-api.md", "docs/architecture.md"],
      [
        {
          skill_id: "sk-1",
          skill_name: "House rubric",
          // Also attached to the agent — must NOT appear twice.
          paths: ["docs/architecture.md", "specs/project-context.md"],
        },
        { skill_id: "sk-2", skill_name: "Security", paths: ["specs/project-context.md"] },
      ],
    );

    expect(effective.map((d) => d.path)).toEqual([
      "specs/public-api.md",
      "docs/architecture.md",
      "specs/project-context.md",
    ]);
    expect(effective.map((d) => d.order)).toEqual([0, 1, 2]);
    // The duplicate keeps the AGENT's position and the agent as its source, so
    // the row offers a detach control rather than a skill label.
    expect(effective[1]?.source).toEqual({ kind: "agent" });
    // The inherited row names the FIRST skill that contributed it.
    expect(effective[2]?.source).toEqual({
      kind: "skill",
      skill_id: "sk-1",
      skill_name: "House rubric",
    });
  });

  it("raises the combined token total by exactly the document that was attached", () => {
    // AC-42: derived from the current attached set on every render, so a toggle
    // moves it with nothing to keep in sync and no reload.
    const before = attachedTokenTotal(DOCS, ["specs/public-api.md"]);
    const after = attachedTokenTotal(DOCS, [
      "specs/public-api.md",
      "specs/project-context.md",
    ]);

    expect(before).toBe(50);
    expect(after).toBe(before + 300);
    // A path whose document is gone from the clone contributes 0 rather than
    // NaN — the attachment stores a path, and the run degrades rather than fails.
    expect(attachedTokenTotal(DOCS, ["specs/deleted.md"])).toBe(0);
  });
});
