import type {
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult
} from "@pige/contracts";
import { EvidenceAssemblyService } from "./evidence-assembly-service";
import type { NotesService, NotesVaultPort } from "./notes-service";
import { readCurrentSourceRecordSnapshot, type CurrentSourceRecordSnapshot } from "./source-file-access";

export class ReaderSourceCitationService {
  constructor(
    private readonly vaults: NotesVaultPort,
    private readonly notes: NotesService,
    private readonly evidence = new EvidenceAssemblyService()
  ) {}

  async resolve(
    ownerId: string,
    request: NoteResolveInlineReferenceRequest
  ): Promise<NoteResolveInlineReferenceResult> {
    const result = this.notes.resolveInlineReference(ownerId, request);
    if (result.status !== "resolved" || result.target.kind !== "source" || !result.target.locator) {
      return result;
    }
    const vault = this.vaults.current();
    const vaultPath = this.vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== request.activeVaultId) return stale(request.requestId);
    const before = readCurrentSourceRecordSnapshot(vaultPath, result.target.sourceId);
    if (!before || before.record.knowledgePageId !== result.target.pageId) return notFound(request.requestId);
    try {
      const preview = await this.evidence.previewCitation(vaultPath, before.record, result.target.locator);
      const after = readCurrentSourceRecordSnapshot(vaultPath, result.target.sourceId);
      if (!preview) return notFound(request.requestId);
      if (
        !after ||
        !sameIdentity(before.identity, after.identity) ||
        !this.notes.isRenderContextCurrent(ownerId, {
          activeVaultId: request.activeVaultId,
          pageId: request.currentPageId,
          renderContextId: request.renderContextId
        })
      ) return stale(request.requestId);
      return { ...result, target: { ...result.target, preview } };
    } catch {
      return { apiVersion: 1, requestId: request.requestId, status: "failed" };
    }
  }
}

function stale(requestId: string): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "stale", scope: "render_context" };
}

function notFound(requestId: string): NoteResolveInlineReferenceResult {
  return { apiVersion: 1, requestId, status: "not_found" };
}

function sameIdentity(
  left: CurrentSourceRecordSnapshot["identity"],
  right: CurrentSourceRecordSnapshot["identity"]
): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs &&
    left.deviceId === right.deviceId && left.fileId === right.fileId;
}
