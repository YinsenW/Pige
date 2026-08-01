import type { RetrievalSearchResult } from "@pige/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createHomeVaultSearchTool,
  projectHomeVaultSearchResult,
  type HomeVaultSearchScope
} from "../../apps/desktop/src/main/services/home-vault-search-tool";

const EMPTY_RESULT: RetrievalSearchResult = {
  searchedAt: "2026-08-02T00:00:00.000Z",
  activeVaultId: "vault_20260802_search",
  query: "Only use my saved knowledge.",
  mode: "lexical_sqlite_fts",
  total: 0,
  invalidPageCount: 0,
  degraded: false,
  results: []
};

describe("HomeVaultSearchTool", () => {
  it("defaults legacy empty input to optional retrieval", async () => {
    const scopes: HomeVaultSearchScope[] = [];
    const tool = makeTool(true, scopes);
    const signal = new AbortController().signal;

    await tool.execute({}, signal, { toolCallId: "search_optional", signal });

    expect(scopes).toEqual(["optional"]);
  });

  it("preserves the exact explicit vault-only scope for Host grounding enforcement", async () => {
    const scopes: HomeVaultSearchScope[] = [];
    const tool = makeTool(true, scopes);
    const signal = new AbortController().signal;

    await tool.execute({ scope: "vault_only" }, signal, { toolCallId: "search_vault_only", signal });

    expect(scopes).toEqual(["vault_only"]);
  });

  it("rejects vault-only authority in Reader-link search tools", async () => {
    const tool = makeTool(false, []);
    const signal = new AbortController().signal;

    expect(() => tool.authorize?.(
      { scope: "vault_only" },
      { toolCallId: "search_reader_scope", signal }
    )).toThrowError(expect.objectContaining({ code: "agent_runtime.tool_call_invalid" }));
    await expect(tool.execute(
      { scope: "vault_only" },
      signal,
      { toolCallId: "search_reader_scope", signal }
    )).rejects.toMatchObject({ code: "agent_runtime.tool_binding_changed" });
  });
});

function makeTool(allowVaultOnly: boolean, scopes: HomeVaultSearchScope[]) {
  return createHomeVaultSearchTool({
    authorize: vi.fn(),
    allowVaultOnly,
    search: (scope) => {
      scopes.push(scope);
      return EMPTY_RESULT;
    },
    projectResult: (result) => projectHomeVaultSearchResult(
      result,
      "<PIGE_UNTRUSTED_EVIDENCE_V1>{}</PIGE_UNTRUSTED_EVIDENCE_V1>",
      0
    )
  });
}
