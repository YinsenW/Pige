import type { BrowserWindow, IpcMain, SaveDialogOptions, WebContents } from "electron";
import type {
  MemoryDeleteRequest,
  MemoryDisableRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryResetRequest,
  MemorySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  MemoryDeleteRequestSchema,
  MemoryDisableRequestSchema,
  MemoryEditRequestSchema,
  MemoryEnableRequestSchema,
  MemoryExportRequestSchema,
  MemoryExportResultSchema,
  MemoryLifecycleMutationResultSchema,
  MemoryListRequestSchema,
  MemoryMutationResultSchema,
  MemoryResetRequestSchema,
  MemorySummarySchema
} from "@pige/schemas";

export interface MemoryVaultBinding {
  readonly vaultId: string;
  readonly vaultPath: string;
}

type Awaitable<T> = T | Promise<T>;

export interface RegisterMemoryIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly getWindow: (sender: WebContents) => BrowserWindow | undefined;
  readonly showSaveDialog: (window: BrowserWindow, options: SaveDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePath?: string;
  }>;
  readonly getActiveVaultBinding: () => MemoryVaultBinding | undefined;
  readonly listMemory: (binding: MemoryVaultBinding, request: MemoryListRequest) => Awaitable<MemorySummary>;
  readonly disableMemory: (
    binding: MemoryVaultBinding,
    request: MemoryDisableRequest
  ) => Awaitable<MemoryMutationResult>;
  readonly enableMemory: (
    binding: MemoryVaultBinding,
    request: MemoryEnableRequest
  ) => Awaitable<MemoryLifecycleMutationResult>;
  readonly editMemory: (
    binding: MemoryVaultBinding,
    request: MemoryEditRequest
  ) => Awaitable<MemoryLifecycleMutationResult>;
  readonly deleteMemory: (
    binding: MemoryVaultBinding,
    request: MemoryDeleteRequest
  ) => Awaitable<MemoryLifecycleMutationResult>;
  readonly exportMemory: (
    binding: MemoryVaultBinding,
    request: MemoryExportRequest,
    destinationPath: string
  ) => Awaitable<MemoryExportResult>;
  readonly resetMemory: (
    binding: MemoryVaultBinding,
    request: MemoryResetRequest
  ) => Awaitable<MemoryLifecycleMutationResult>;
  readonly publishMemoryChanged: (summary: MemorySummary) => void;
}

export function registerMemoryIpc(options: RegisterMemoryIpcOptions): void {
  options.ipcMain.handle("memory.list", async (_event, request: unknown) => {
    const parsed = MemoryListRequestSchema.parse(request);
    const binding = requireVaultBinding(options, parsed.activeVaultId);
    const summary = MemorySummarySchema.parse(await options.listMemory(binding, parsed));
    assertSummaryIdentity(parsed.activeVaultId, summary);
    return summary;
  });

  options.ipcMain.handle("memory.disable", async (_event, request: unknown) => {
    const parsed = MemoryDisableRequestSchema.parse(request);
    const binding = requireVaultBinding(options, parsed.activeVaultId);
    const result = MemoryMutationResultSchema.parse(await options.disableMemory(binding, parsed));
    assertSummaryIdentity(parsed.activeVaultId, result.summary);
    publishCommitted(options, result);
    return result;
  });

  registerLifecycleMutation(options, "memory.edit", MemoryEditRequestSchema, options.editMemory);
  registerLifecycleMutation(options, "memory.enable", MemoryEnableRequestSchema, options.enableMemory);
  registerLifecycleMutation(options, "memory.delete", MemoryDeleteRequestSchema, options.deleteMemory);
  registerLifecycleMutation(options, "memory.reset", MemoryResetRequestSchema, options.resetMemory);

  options.ipcMain.handle("memory.export", async (event, request: unknown): Promise<MemoryExportResult> => {
    const parsed = MemoryExportRequestSchema.parse(request);
    const initialBinding = requireVaultBinding(options, parsed.activeVaultId);
    const window = options.getWindow(event.sender);
    if (!window) return exportStatus(parsed, "failed");

    let selection: { readonly canceled: boolean; readonly filePath?: string };
    try {
      selection = await options.showSaveDialog(window, {
        title: "Export Agent Memory",
        defaultPath: `pige-memory-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }]
      });
    } catch {
      return exportStatus(parsed, "failed");
    }
    if (selection.canceled || !selection.filePath) return exportStatus(parsed, "cancelled");

    const currentBinding = options.getActiveVaultBinding();
    if (!sameBinding(initialBinding, currentBinding)) return exportStatus(parsed, "failed");
    try {
      const result = MemoryExportResultSchema.parse(
        await options.exportMemory(initialBinding, parsed, selection.filePath)
      );
      assertExportIdentity(parsed, result);
      return result;
    } catch {
      return exportStatus(parsed, "failed");
    }
  });
}

type LifecycleRequest = MemoryEditRequest | MemoryEnableRequest | MemoryDeleteRequest | MemoryResetRequest;

function registerLifecycleMutation<TRequest extends LifecycleRequest>(
  options: RegisterMemoryIpcOptions,
  channel: "memory.edit" | "memory.enable" | "memory.delete" | "memory.reset",
  schema: { parse(value: unknown): TRequest },
  mutate: (binding: MemoryVaultBinding, request: TRequest) => Awaitable<MemoryLifecycleMutationResult>
): void {
  options.ipcMain.handle(channel, async (_event, request: unknown) => {
    const parsed = schema.parse(request);
    const binding = requireVaultBinding(options, parsed.activeVaultId);
    const result = MemoryLifecycleMutationResultSchema.parse(await mutate(binding, parsed));
    assertLifecycleIdentity(parsed, result);
    publishCommitted(options, result);
    return result;
  });
}

function requireVaultBinding(
  options: Pick<RegisterMemoryIpcOptions, "getActiveVaultBinding">,
  activeVaultId: string
): MemoryVaultBinding {
  const binding = options.getActiveVaultBinding();
  if (!binding || binding.vaultId !== activeVaultId) {
    throw new PigeDomainError("vault.binding_changed", "The active vault changed before the memory operation.");
  }
  return binding;
}

function sameBinding(
  expected: MemoryVaultBinding,
  current: MemoryVaultBinding | undefined
): current is MemoryVaultBinding {
  return current?.vaultId === expected.vaultId && current.vaultPath === expected.vaultPath;
}

function assertSummaryIdentity(activeVaultId: string, summary: MemorySummary): void {
  if (summary.activeVaultId !== activeVaultId) {
    throw new PigeDomainError("vault.binding_changed", "The memory result belongs to another vault.");
  }
}

function assertLifecycleIdentity(
  request: LifecycleRequest,
  result: MemoryLifecycleMutationResult
): void {
  if (
    result.apiVersion !== request.apiVersion ||
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId
  ) {
    throw new PigeDomainError("memory.request_conflict", "The memory result identity changed during mutation.");
  }
  assertSummaryIdentity(request.activeVaultId, result.summary);
}

function assertExportIdentity(request: MemoryExportRequest, result: MemoryExportResult): void {
  if (
    result.apiVersion !== request.apiVersion ||
    result.requestId !== request.requestId ||
    result.activeVaultId !== request.activeVaultId
  ) {
    throw new PigeDomainError("memory.request_conflict", "The memory export identity changed during export.");
  }
}

function exportStatus(
  request: MemoryExportRequest,
  status: "cancelled" | "failed"
): MemoryExportResult {
  return MemoryExportResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    revision: request.expectedRevision,
    status
  });
}

function publishCommitted(
  options: Pick<RegisterMemoryIpcOptions, "publishMemoryChanged">,
  result: MemoryMutationResult | MemoryLifecycleMutationResult
): void {
  if (result.status === "committed") options.publishMemoryChanged(result.summary);
}
