import type { RetrievalSearchRequest, RetrievalSearchResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  RetrievalSearchRequestSchema,
  RetrievalSearchResultSchema
} from "@pige/schemas";

export interface RetrievalSearchIpcPort {
  search(request: RetrievalSearchRequest): unknown;
}

export function handleRetrievalSearchIpc(
  request: unknown,
  retrieval: RetrievalSearchIpcPort
): RetrievalSearchResult {
  const parsedRequest = RetrievalSearchRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    throw new PigeDomainError("rag.search_request_invalid", "The local search request is invalid.");
  }

  let rawResult: unknown;
  try {
    rawResult = retrieval.search(parsedRequest.data);
  } catch {
    throw new PigeDomainError("rag.search_unavailable", "Local search is temporarily unavailable.");
  }

  const parsedResult = RetrievalSearchResultSchema.safeParse(rawResult);
  if (
    !parsedResult.success ||
    parsedResult.data.activeVaultId !== parsedRequest.data.scope.vaultId ||
    parsedResult.data.query !== parsedRequest.data.query
  ) {
    throw new PigeDomainError("rag.search_response_invalid", "The local search result is unavailable.");
  }
  return parsedResult.data;
}
