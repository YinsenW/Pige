import type {
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult
} from "@pige/contracts";
import type { NotesService } from "./notes-service";
import { readCurrentSourceRecordSnapshot } from "./source-file-access";
import {
  canReconnectOriginalSource,
  type SourceOriginalReconnectService
} from "./source-original-reconnect-service";

export function reconnectableOriginalSourceIds(
  vaultPath: string,
  sourceIds: readonly string[]
): string[] {
  return sourceIds.slice(0, 5).filter((sourceId) => {
    const source = readCurrentSourceRecordSnapshot(vaultPath, sourceId);
    return source ? canReconnectOriginalSource(source.record) : false;
  });
}

export interface ReaderSourceReconnectPicker {
  pick(): Promise<string | undefined>;
}

export class ReaderSourceReconnectService {
  readonly #notes: Pick<NotesService, "resolveSourceReveal" | "render">;
  readonly #reconnect: Pick<SourceOriginalReconnectService, "reconnect">;

  constructor(
    notes: Pick<NotesService, "resolveSourceReveal" | "render">,
    reconnect: Pick<SourceOriginalReconnectService, "reconnect">
  ) {
    this.#notes = notes;
    this.#reconnect = reconnect;
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

    let selectedPath: string | undefined;
    try {
      selectedPath = await picker.pick();
    } catch {
      return { ...identity, status: "failed" };
    }
    if (!selectedPath) return { ...identity, status: "cancelled" };
    if (!resolved.assertCurrent()) return { ...identity, status: "stale" };

    const status = await this.#reconnect.reconnect(
      { activeVaultId: request.activeVaultId, sourceId: request.sourceId },
      selectedPath,
      resolved.assertCurrent
    );
    if (status !== "reconnected") return { ...identity, status };
    try {
      const render = await this.#notes.render({ pageId: request.currentPageId }, ownerId);
      return render.renderContextId
        ? { ...identity, status: "reconnected", render }
        : { ...identity, status: "failed" };
    } catch {
      return { ...identity, status: "failed" };
    }
  }
}
