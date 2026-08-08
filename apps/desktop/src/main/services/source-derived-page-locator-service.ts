import type {
  LibraryPageSummary,
  NoteListSourceDerivedRequest,
  NoteListSourceDerivedResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  VaultSummary
} from "@pige/contracts";
import { normalizeMarkdownPageReferenceKey, readMarkdownPageByRelativePath, scanMarkdownPages } from "./markdown-page-index";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";

interface FileIdentity {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly deviceId: string;
  readonly fileId: string;
}

export interface SourceDerivedPageRenderContext {
  readonly vaultId: string;
  readonly vaultPath: string;
  readonly pageId: string;
  readonly pageType: string;
  readonly pagePath: string;
  readonly sourceIds: ReadonlySet<string>;
  readonly referenceIndexRevision?: string;
  readonly ownerEpoch: number;
}

export interface SourceDerivedPageLocatorPort {
  readonly vault: VaultSummary | undefined;
  readonly vaultPath: string | undefined;
  readonly ownerEpoch: number | undefined;
  readContext(): SourceDerivedPageRenderContext | undefined;
  matchesCurrentScope(context: SourceDerivedPageRenderContext): boolean;
  matchesCurrentPage(context: SourceDerivedPageRenderContext): boolean;
  inlineReferenceCandidates?(
    vaultPath: string,
    request: {
      readonly normalizedKey: string;
      readonly expectedRevision: string;
      readonly exactPageId?: string;
    }
  ): readonly LibraryPageSummary[] | undefined;
}

export class SourceDerivedPageLocatorService {
  readonly #port: SourceDerivedPageLocatorPort;

  constructor(port: SourceDerivedPageLocatorPort) {
    this.#port = port;
  }

  openSourceReference(request: NoteOpenSourceReferenceRequest): NoteOpenSourceReferenceResult {
    const state = this.#resolve(request);
    if (state.status !== "ready") return sourceReferenceResult(request.requestId, state.status);
    if (!state.context.referenceIndexRevision || !this.#port.inlineReferenceCandidates) {
      return sourceReferenceResult(request.requestId, "unresolved");
    }
    try {
      const source = readCurrentSourceRecordSnapshot(state.vaultPath, request.sourceId);
      const pageId = source?.record.knowledgePageId;
      if (!source || !pageId) return sourceReferenceResult(request.requestId, "unresolved");
      const candidates = this.#port.inlineReferenceCandidates(state.vaultPath, {
        normalizedKey: normalizeMarkdownPageReferenceKey(pageId),
        expectedRevision: state.context.referenceIndexRevision,
        exactPageId: pageId
      });
      if (!candidates) return sourceReferenceResult(request.requestId, "unresolved");
      if (candidates.length !== 1) return sourceReferenceResult(request.requestId, "not_found");
      const candidate = candidates[0]!;
      const current = readMarkdownPageByRelativePath(state.vaultPath, candidate.pagePath);
      if (!current || current.summary.pageId !== pageId || current.summary.pageType !== "source" ||
        !current.summary.sourceIds.includes(request.sourceId) ||
        (source.record.knowledgePagePath !== undefined && source.record.knowledgePagePath !== candidate.pagePath)) {
        return sourceReferenceResult(request.requestId, "mismatch");
      }
      const after = readCurrentSourceRecordSnapshot(state.vaultPath, request.sourceId);
      if (!after || !sameFileIdentity(source.identity, after.identity)) return sourceReferenceResult(request.requestId, "changed");
      const currentStatus = this.#currentStatus(state.context);
      if (currentStatus !== "current") return sourceReferenceResult(request.requestId, currentStatus);
      return { apiVersion: 1, requestId: request.requestId, status: "resolved", target: { pageId } };
    } catch {
      return sourceReferenceResult(request.requestId, "unresolved");
    }
  }

  listDerived(request: NoteListSourceDerivedRequest): NoteListSourceDerivedResult {
    const state = this.#resolve(request);
    if (state.status !== "ready") return derivedResult(request.requestId, state.status);
    if (state.context.pageType !== "source") return derivedResult(request.requestId, "mismatch");
    try {
      const source = readCurrentSourceRecordSnapshot(state.vaultPath, request.sourceId);
      if (!source) return derivedResult(request.requestId, "not_found");
      if (source.record.knowledgePageId !== state.context.pageId ||
        (source.record.knowledgePagePath !== undefined && source.record.knowledgePagePath !== state.context.pagePath)) {
        return derivedResult(request.requestId, "mismatch");
      }
      const pages = scanMarkdownPages(state.vaultPath).pages
        .filter((page) => page.summary.pageId !== state.context.pageId && page.summary.pageType !== "source" &&
          page.summary.status === "active" && page.summary.sourceIds.includes(request.sourceId))
        .map((page) => ({
          pageId: page.summary.pageId,
          title: page.summary.title,
          pageType: page.summary.pageType,
          updatedAt: page.summary.updatedAt
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt, "en-US") || left.pageId.localeCompare(right.pageId, "en-US"))
        .slice(0, 32);
      const after = readCurrentSourceRecordSnapshot(state.vaultPath, request.sourceId);
      if (!after || !sameFileIdentity(source.identity, after.identity)) return derivedResult(request.requestId, "changed");
      const currentStatus = this.#currentStatus(state.context);
      if (currentStatus !== "current") return derivedResult(request.requestId, currentStatus);
      return { apiVersion: 1, requestId: request.requestId, status: "ready", sourceId: request.sourceId, pages };
    } catch {
      return derivedResult(request.requestId, "failed");
    }
  }

  #resolve(request: Pick<NoteOpenSourceReferenceRequest, "activeVaultId" | "currentPageId" | "renderContextId" | "sourceId">):
    | { readonly status: "ready"; readonly vaultPath: string; readonly context: SourceDerivedPageRenderContext }
    | { readonly status: "stale" | "mismatch" | "changed" } {
    const vaultPath = this.#port.vaultPath;
    const context = this.#port.readContext();
    if (!this.#port.vault || !vaultPath || this.#port.vault.vaultId !== request.activeVaultId) return { status: "stale" };
    if (!context || context.vaultId !== request.activeVaultId || context.vaultPath !== vaultPath ||
      context.pageId !== request.currentPageId || this.#port.ownerEpoch !== context.ownerEpoch) return { status: "stale" };
    if (!context.sourceIds.has(request.sourceId)) return { status: "mismatch" };
    if (!this.#port.matchesCurrentPage(context)) return { status: "changed" };
    return { status: "ready", vaultPath, context };
  }

  #currentStatus(context: SourceDerivedPageRenderContext): "current" | "stale" | "changed" {
    if (!this.#port.matchesCurrentScope(context)) return "stale";
    return this.#port.ownerEpoch === context.ownerEpoch && this.#port.matchesCurrentPage(context) ? "current" : "changed";
  }
}

function sourceReferenceResult(
  requestId: string,
  status: Exclude<NoteOpenSourceReferenceResult["status"], "resolved">
): NoteOpenSourceReferenceResult {
  return { apiVersion: 1, requestId, status };
}

function derivedResult(
  requestId: string,
  status: Exclude<NoteListSourceDerivedResult["status"], "ready">
): NoteListSourceDerivedResult {
  return { apiVersion: 1, requestId, status };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId && left.fileId === right.fileId;
}
