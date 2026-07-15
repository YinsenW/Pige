import { describe, expect, it } from "vitest";
import type { RetrievalSearchRequest } from "@pige/contracts";
import { handleRetrievalSearchIpc } from "../../apps/desktop/src/main/services/retrieval-search-ipc";

const vaultId = "vault_20260709_searchipc";

function validResult() {
  return {
    searchedAt: "2026-07-09T12:00:00.000Z",
    activeVaultId: vaultId,
    query: "bounded local search",
    mode: "lexical_markdown_scan",
    total: 1,
    invalidPageCount: 0,
    degraded: true,
    degradedReason: "local_database_not_ready",
    results: [{
      summary: {
        pageId: "page_20260709_searchipc",
        title: "Bounded Search",
        pageType: "note",
        status: "active",
        pagePath: "wiki/bounded-search.md",
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:00.000Z",
        sourceIds: []
      },
      score: 18.5,
      snippets: ["A bounded local snippet."],
      matchReasons: ["title", "body"]
    }]
  };
}

describe("retrieval.search IPC boundary", () => {
  it("accepts a 320-character query and rejects a 321-character query before retrieval", () => {
    let searchCalls = 0;
    const search = (request: RetrievalSearchRequest) => {
      searchCalls += 1;
      return { ...validResult(), query: request.query };
    };

    expect(handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: "a".repeat(320)
    }, { search })).toMatchObject({ query: "a".repeat(320) });
    expect(searchCalls).toBe(1);

    expect(handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: "😀".repeat(320)
    }, { search })).toMatchObject({ query: "😀".repeat(320) });
    expect(searchCalls).toBe(2);

    expect(() => handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: "a".repeat(321)
    }, { search })).toThrowError(expect.objectContaining({ code: "rag.search_request_invalid" }));
    expect(() => handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: "😀".repeat(321)
    }, { search })).toThrowError(expect.objectContaining({ code: "rag.search_request_invalid" }));
    expect(searchCalls).toBe(2);
  });

  it("rejects malformed requests without invoking local retrieval or echoing the query", () => {
    let searchCalls = 0;
    let caught: unknown;
    try {
      handleRetrievalSearchIpc({ query: "PRIVATE_QUERY_BODY", limit: 200 }, {
        search: () => {
          searchCalls += 1;
          return validResult();
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(searchCalls).toBe(0);
    expect(caught).toMatchObject({
      code: "rag.search_request_invalid",
      message: "The local search request is invalid."
    });
    expect(caught instanceof Error ? caught.message : "").not.toContain("PRIVATE_QUERY_BODY");
  });

  it("bounds request identities before invoking retrieval", () => {
    let searchCalls = 0;
    expect(() => handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId: `vault_20260709_${"a".repeat(200)}` },
      query: "bounded local search"
    }, {
      search: () => {
        searchCalls += 1;
        return validResult();
      }
    })).toThrowError(expect.objectContaining({ code: "rag.search_request_invalid" }));
    expect(searchCalls).toBe(0);
  });

  it("replaces thrown retrieval details with one fixed body-free error", () => {
    const privateDetail = "ENOENT /Users/alice/private-vault/wiki/secret.md PRIVATE_BODY";
    let caught: unknown;
    try {
      handleRetrievalSearchIpc({
        scope: { kind: "active_vault", vaultId },
        query: "bounded local search"
      }, {
        search: () => {
          throw new Error(privateDetail);
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "rag.search_unavailable",
      message: "Local search is temporarily unavailable."
    });
    expect(caught instanceof Error ? caught.message : "").not.toContain(privateDetail);
  });

  it("rejects malformed service responses without exposing paths or bodies", () => {
    const privatePath = "/Users/alice/private-vault/wiki/secret.md";
    let caught: unknown;
    try {
      handleRetrievalSearchIpc({
        scope: { kind: "active_vault", vaultId },
        query: "bounded local search",
        limit: 8
      }, {
        search: () => ({
          ...validResult(),
          results: [{
            ...validResult().results[0],
            summary: { ...validResult().results[0]?.summary, pagePath: privatePath },
            snippets: ["PRIVATE_FULL_BODY"]
          }]
        })
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "rag.search_response_invalid",
      message: "The local search result is unavailable."
    });
    const message = caught instanceof Error ? caught.message : "";
    expect(message).not.toContain(privatePath);
    expect(message).not.toContain("PRIVATE_FULL_BODY");
  });

  it("rejects operational and non-Markdown paths from service responses", () => {
    for (const pagePath of [
      ".pige/source-records/private.json",
      "raw/files/private.pdf",
      "wiki\\private.md",
      "wiki/private.txt",
      "wiki/../private.md"
    ]) {
      expect(() => handleRetrievalSearchIpc({
        scope: { kind: "active_vault", vaultId },
        query: "bounded local search"
      }, {
        search: () => ({
          ...validResult(),
          results: [{
            ...validResult().results[0],
            summary: { ...validResult().results[0]?.summary, pagePath }
          }]
        })
      })).toThrowError(expect.objectContaining({ code: "rag.search_response_invalid" }));
    }
  });

  it("bounds response identities before returning them to the renderer", () => {
    for (const summaryPatch of [
      { pageId: `page_20260709_${"a".repeat(200)}` },
      { sourceIds: [`src_20260709_${"a".repeat(200)}`] }
    ]) {
      expect(() => handleRetrievalSearchIpc({
        scope: { kind: "active_vault", vaultId },
        query: "bounded local search"
      }, {
        search: () => ({
          ...validResult(),
          results: [{
            ...validResult().results[0],
            summary: { ...validResult().results[0]?.summary, ...summaryPatch }
          }]
        })
      })).toThrowError(expect.objectContaining({ code: "rag.search_response_invalid" }));
    }
  });

  it("rejects a schema-valid response bound to a stale vault", () => {
    expect(() => handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: "bounded local search"
    }, {
      search: () => ({ ...validResult(), activeVaultId: "vault_20260709_staleresult" })
    })).toThrowError(expect.objectContaining({ code: "rag.search_response_invalid" }));
  });

  it("returns a validated bounded local result with stable page identity", () => {
    const result = handleRetrievalSearchIpc({
      scope: { kind: "active_vault", vaultId },
      query: " bounded local search ",
      limit: 8,
      pageTypes: ["note"]
    }, {
      search: (request) => ({ ...validResult(), query: request.query })
    });

    expect(result).toMatchObject({
      activeVaultId: vaultId,
      query: "bounded local search",
      total: 1
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.summary.pageId).toBe("page_20260709_searchipc");
    expect(result.results[0]?.snippets[0]?.length).toBeLessThanOrEqual(260);
  });
});
