import type {
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  ReferencedOriginalReconnectCandidate
} from "@pige/contracts";
import type { NotesService } from "./notes-service";
import {
  canReconnectOriginalSource,
  readReferencedOriginalReconnectCandidate,
  type SourceOriginalReconnectService
} from "./source-original-reconnect-service";

export function reconnectableOriginalSourceIds(
  vaultPath: string,
  sourceIds: readonly string[]
): string[] {
  return reconnectableOriginalSources(vaultPath, sourceIds).map((source) => source.sourceId);
}

export function reconnectableOriginalSources(
  vaultPath: string,
  sourceIds: readonly string[]
): ReferencedOriginalReconnectCandidate[] {
  return sourceIds.slice(0, 5).flatMap((sourceId) => {
    try {
      const source = readReferencedOriginalReconnectCandidate(vaultPath, sourceId);
      return source ? [source] : [];
    } catch {
      return [];
    }
  });
}

export interface ReaderSourceReconnectPicker {
  pick(): Promise<string | undefined>;
}

export class ReaderSourceReconnectService {
  readonly #notes: Pick<NotesService, "resolveSourceReveal" | "render">;
  readonly #reconnect: Pick<SourceOriginalReconnectService, "reconnect" | "confirmChanged" | "acknowledge">;
  readonly #onReconnected: (sourceId: string) => number;

  constructor(
    notes: Pick<NotesService, "resolveSourceReveal" | "render">,
    reconnect: Pick<SourceOriginalReconnectService, "reconnect" | "confirmChanged" | "acknowledge">,
    onReconnected: (sourceId: string) => number = () => 0
  ) {
    this.#notes = notes;
    this.#reconnect = reconnect;
    this.#onReconnected = onReconnected;
  }

  async reconnect(
    ownerId: string,
    request: NoteReconnectOriginalSourceRequest,
    picker: ReaderSourceReconnectPicker
  ): Promise<NoteReconnectOriginalSourceResult> {
    const identity = { ...request } as const;
    const resolved = this.#notes.resolveSourceReveal(ownerId, request);
    if (resolved.status !== "ready") return { ...identity, status: resolved.status };
    if (!canReconnectOriginalSource(resolved.sourceRecord)) {
      return { ...identity, status: "ineligible" };
    }
    const candidate = resolved.reconnectCandidate;
    if (!candidate || !sameProof(candidate, request)) return { ...identity, status: "stale" };

    const binding = {
        activeVaultId: request.activeVaultId,
        requestId: request.requestId,
        sourceId: request.sourceId,
        sourceKind: request.sourceKind,
        sourceRevision: request.sourceRevision,
        expectedAvailability: request.expectedAvailability,
        expectedChecksum: request.expectedChecksum,
        expectedSize: request.expectedSize,
        formatIdentity: request.formatIdentity
      } as const;
    let status;
    if (request.previewId) {
      status = await this.#reconnect.confirmChanged({ ...binding, previewId: request.previewId }, resolved.assertCurrent);
    } else {
      let selectedPath: string | undefined;
      try {
        selectedPath = await picker.pick();
      } catch {
        return { ...identity, status: "failed" };
      }
      if (!selectedPath) return { ...identity, status: "cancelled" };
      if (!resolved.assertCurrent()) return { ...identity, status: "stale" };
      status = await this.#reconnect.reconnect(binding, selectedPath, resolved.assertCurrent);
    }
    if (status.status === "changed") return { ...identity, status: "changed", preview: status.preview };
    if (status.status !== "reconnected") return { ...identity, status: status.status };
    try {
      const resumedJobCount = this.#onReconnected(request.sourceId);
      this.#reconnect.acknowledge(status.operationId);
      const render = await this.#notes.render({ pageId: request.currentPageId }, ownerId);
      return render.renderContextId
        ? { ...identity, status: "reconnected", render, operationId: status.operationId,
            contentState: status.contentState, resumedJobCount }
        : { ...identity, status: "failed" };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
}

function sameProof(
  candidate: ReferencedOriginalReconnectCandidate,
  request: NoteReconnectOriginalSourceRequest
): boolean {
  return candidate.sourceId === request.sourceId && candidate.sourceKind === request.sourceKind &&
    candidate.sourceRevision === request.sourceRevision &&
    candidate.expectedAvailability === request.expectedAvailability &&
    candidate.expectedChecksum === request.expectedChecksum && candidate.expectedSize === request.expectedSize &&
    candidate.formatIdentity === request.formatIdentity;
}
