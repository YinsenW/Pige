import type { IpcMain, WebContents } from "electron";
import {
  COLLECTION_ANALYTICAL_SNAPSHOT_CITATION_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_LIST_TRASH_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_RESTORE_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_TRASH_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_CREATE_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_LIST_CHANNEL,
  COLLECTION_ANALYTICAL_SNAPSHOT_OPEN_CHANNEL,
  CollectionAnalyticalSnapshotCitationRequestSchema,
  CollectionAnalyticalSnapshotCitationResultSchema,
  CollectionAnalyticalSnapshotListTrashRequestSchema,
  CollectionAnalyticalSnapshotListTrashResultSchema,
  CollectionAnalyticalSnapshotRestoreRequestSchema,
  CollectionAnalyticalSnapshotRestoreResultSchema,
  CollectionAnalyticalSnapshotTrashRequestSchema,
  CollectionAnalyticalSnapshotTrashResultSchema,
  CollectionAnalyticalSnapshotCreateRequestSchema,
  CollectionAnalyticalSnapshotCreateResultSchema,
  CollectionAnalyticalSnapshotListRequestSchema,
  CollectionAnalyticalSnapshotListResultSchema,
  CollectionAnalyticalSnapshotOpenRequestSchema,
  CollectionAnalyticalSnapshotOpenResultSchema,
  type CollectionAnalyticalSnapshotCitationRequest,
  type CollectionAnalyticalSnapshotCreateRequest,
  type CollectionAnalyticalSnapshotListRequest,
  type CollectionAnalyticalSnapshotOpenRequest
} from "@pige/schemas";
import {
  AnalyticalSnapshotService,
  toAnalyticalSnapshotSummary
} from "./services/analytical-snapshot-service";
import { AnalyticalSnapshotTrashService } from "./services/analytical-snapshot-trash-service";

interface RegisterAnalyticalSnapshotIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly service: AnalyticalSnapshotService;
  readonly trashService: AnalyticalSnapshotTrashService;
}

export function registerAnalyticalSnapshotIpc(options: RegisterAnalyticalSnapshotIpcOptions): void {
  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_LIST_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotListRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return { ...request, status: "failed" as const };
    try {
      return CollectionAnalyticalSnapshotListResultSchema.parse({
        ...request,
        status: "ready",
        snapshots: options.service.list(request.activeVaultId)
      });
    } catch {
      return CollectionAnalyticalSnapshotListResultSchema.parse({ ...request, status: "failed" });
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_CREATE_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotCreateRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return failedCreate(request);
    try {
      const result = options.service.create(request);
      return CollectionAnalyticalSnapshotCreateResultSchema.parse({
        ...request,
        status: result.status,
        ...(result.status === "committed" || result.status === "already_committed"
          ? { snapshot: toAnalyticalSnapshotSummary(result.record) }
          : {})
      });
    } catch {
      return failedCreate(request);
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_OPEN_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotOpenRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return failedOpen(request);
    try {
      const result = options.service.open(request.activeVaultId, request.snapshotId);
      return CollectionAnalyticalSnapshotOpenResultSchema.parse({
        ...request,
        status: result.status,
        ...(result.status === "ready" ? { preview: result.preview } : {})
      });
    } catch {
      return failedOpen(request);
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_CITATION_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotCitationRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return failedCitation(request);
    try {
      const result = options.service.openCitation(request.activeVaultId, request.snapshotId, request.rowId);
      return CollectionAnalyticalSnapshotCitationResultSchema.parse({
        ...request,
        status: result.status,
        ...(result.status === "ready" ? { citation: result.citation } : {})
      });
    } catch {
      return failedCitation(request);
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_LIST_TRASH_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotListTrashRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return CollectionAnalyticalSnapshotListTrashResultSchema.parse({ ...request, status: "failed" });
    try {
      return CollectionAnalyticalSnapshotListTrashResultSchema.parse(options.trashService.listTrash(request));
    } catch {
      return CollectionAnalyticalSnapshotListTrashResultSchema.parse({ ...request, status: "failed" });
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_TRASH_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotTrashRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return CollectionAnalyticalSnapshotTrashResultSchema.parse({ ...request, status: "failed" });
    try {
      return CollectionAnalyticalSnapshotTrashResultSchema.parse(options.trashService.trash(request));
    } catch {
      return CollectionAnalyticalSnapshotTrashResultSchema.parse({ ...request, status: "failed" });
    }
  });

  options.ipcMain.handle(COLLECTION_ANALYTICAL_SNAPSHOT_RESTORE_CHANNEL, (event, input: unknown) => {
    const request = CollectionAnalyticalSnapshotRestoreRequestSchema.parse(input);
    if (!trusted(options, event.sender, request.activeVaultId)) return CollectionAnalyticalSnapshotRestoreResultSchema.parse({ ...request, status: "failed" });
    try {
      return CollectionAnalyticalSnapshotRestoreResultSchema.parse(options.trashService.restore(request));
    } catch {
      return CollectionAnalyticalSnapshotRestoreResultSchema.parse({ ...request, status: "failed" });
    }
  });
}

function trusted(options: RegisterAnalyticalSnapshotIpcOptions, sender: WebContents, activeVaultId: string): boolean {
  return options.isTrustedSender(sender) && options.getActiveVaultId() === activeVaultId;
}

function failedCreate(request: CollectionAnalyticalSnapshotCreateRequest) {
  return CollectionAnalyticalSnapshotCreateResultSchema.parse({ ...request, status: "failed" });
}

function failedOpen(request: CollectionAnalyticalSnapshotOpenRequest) {
  return CollectionAnalyticalSnapshotOpenResultSchema.parse({ ...request, status: "failed" });
}

function failedCitation(request: CollectionAnalyticalSnapshotCitationRequest) {
  return CollectionAnalyticalSnapshotCitationResultSchema.parse({ ...request, status: "failed" });
}
