import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerMemoryIpc } from "../../apps/desktop/src/main/register-memory-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const activeVaultId = "vault_20260727_memoryipc";
const binding = { vaultId: activeVaultId, vaultPath: "/private/vault" } as const;
const recordRequest = {
  apiVersion: 1,
  requestId: "memory_request_abcdefghijklmnop",
  activeVaultId,
  memoryId: "memory_20260727_abcdefghijkl",
  expectedRevision: 7
} as const;
const vaultRequest = {
  apiVersion: 1,
  requestId: "memory_request_qrstuvwxyzabcdef",
  activeVaultId,
  expectedRevision: 7
} as const;
const summary = {
  apiVersion: 1,
  activeVaultId,
  revision: 8,
  records: [{
    id: recordRequest.memoryId,
    kind: "preference",
    title: "Concise replies",
    body: "Prefer concise replies.",
    status: "active",
    provenance: { kind: "explicit_user_request", occurredAt: "2026-07-27T10:00:00.000Z" },
    createdAt: "2026-07-27T10:00:00.000Z",
    updatedAt: "2026-07-27T10:01:00.000Z"
  }]
} as const;
const trashSummary = {
  apiVersion: 1,
  activeVaultId,
  revision: 8,
  records: [{
    memoryId: recordRequest.memoryId,
    trashOperationId: "op_20260727_memorytrash",
    kind: "preference",
    title: "Concise replies",
    trashedAt: "2026-07-27T10:02:00.000Z"
  }],
  resets: []
} as const;

function makeHarness(overrides: {
  readonly getActiveVaultBinding?: () => typeof binding | undefined;
  readonly showSaveDialog?: () => Promise<{ readonly canceled: boolean; readonly filePath?: string }>;
  readonly exportMemory?: (...args: any[]) => unknown;
  readonly editMemory?: (...args: any[]) => unknown;
  readonly enableMemory?: (...args: any[]) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const publishMemoryChanged = vi.fn();
  const listMemory = vi.fn(() => summary);
  const listMemoryTrash = vi.fn(() => trashSummary);
  const disableMemory = vi.fn(() => ({ status: "committed", summary } as const));
  const lifecycle = (request: typeof recordRequest | typeof vaultRequest) => ({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status: "committed" as const,
    operationId: "op_20260727_memoryipc",
    summary
  });
  const enableMemory = vi.fn(overrides.enableMemory ?? ((_binding, request) => lifecycle(request)));
  const editMemory = vi.fn(overrides.editMemory ?? ((_binding, request) => lifecycle(request)));
  const deleteMemory = vi.fn((_binding, request) => lifecycle(request));
  const resetMemory = vi.fn((_binding, request) => lifecycle(request));
  const restoreMemoryTrash = vi.fn((_binding, request) => ({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status: "committed" as const,
    operationId: "op_20260727_memoryrestore",
    summary,
    trash: { ...trashSummary, records: [], resets: [] }
  }));
  const exportMemory = vi.fn(overrides.exportMemory ?? ((_binding, request) => ({
    apiVersion: 1,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    revision: request.expectedRevision,
    status: "exported" as const
  })));

  registerMemoryIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as IpcHandler) } as Pick<IpcMain, "handle">,
    getWindow: () => ({} as never),
    showSaveDialog: overrides.showSaveDialog ?? (async () => ({
      canceled: false,
      filePath: "/private/export.json"
    })),
    getActiveVaultBinding: overrides.getActiveVaultBinding ?? (() => binding),
    listMemory,
    listMemoryTrash,
    restoreMemoryTrash,
    disableMemory,
    editMemory,
    enableMemory,
    deleteMemory,
    exportMemory,
    resetMemory,
    publishMemoryChanged
  });
  return {
    handlers,
    publishMemoryChanged,
    listMemory,
    disableMemory,
    editMemory,
    enableMemory,
    deleteMemory,
    exportMemory,
    resetMemory
  };
}

describe("registerMemoryIpc", () => {
  it("registers the strict lifecycle surface and publishes only committed mutations", async () => {
    const harness = makeHarness();
    expect([...harness.handlers.keys()]).toEqual([
      "memory.list",
      "memory.listTrash",
      "memory.restoreTrash",
      "memory.disable",
      "memory.edit",
      "memory.enable",
      "memory.delete",
      "memory.reset",
      "memory.export"
    ]);

    await expect(call(harness, "memory.list", { apiVersion: 1, activeVaultId })).resolves.toEqual(summary);
    await expect(call(harness, "memory.listTrash", { apiVersion: 1, activeVaultId })).resolves.toEqual(trashSummary);
    await expect(call(harness, "memory.restoreTrash", {
      ...recordRequest,
      trashOperationId: trashSummary.records[0].trashOperationId
    })).resolves.toMatchObject({ status: "committed", trash: { records: [] } });
    await expect(call(harness, "memory.disable", recordRequest)).resolves.toMatchObject({ status: "committed" });
    await expect(call(harness, "memory.edit", {
      ...recordRequest,
      title: "Updated memory",
      body: "Updated safe memory body."
    })).resolves.toMatchObject({ status: "committed" });
    await expect(call(harness, "memory.enable", recordRequest)).resolves.toMatchObject({ status: "committed" });
    await expect(call(harness, "memory.delete", recordRequest)).resolves.toMatchObject({ status: "committed" });
    await expect(call(harness, "memory.reset", vaultRequest)).resolves.toMatchObject({ status: "committed" });
    expect(harness.publishMemoryChanged).toHaveBeenCalledTimes(6);
    expect(harness.publishMemoryChanged).toHaveBeenCalledWith(summary);
  });

  it("strictly rejects malformed requests and identity-swapped results", async () => {
    const harness = makeHarness({
      editMemory: (_binding, request) => ({
        ...lifecycleResult(request),
        receiptPath: "/private/memory/edit-receipt.json"
      }),
      enableMemory: (_binding, request) => ({
        apiVersion: 1,
        requestId: "memory_request_wrongidentity1",
        activeVaultId: request.activeVaultId,
        status: "stale",
        summary
      })
    });
    await expect(call(harness, "memory.delete", { ...recordRequest, path: "/private/memory.json" }))
      .rejects.toThrow();
    await expect(call(harness, "memory.edit", { ...recordRequest, title: "Missing body" }))
      .rejects.toThrow();
    await expect(call(harness, "memory.edit", {
      ...recordRequest,
      title: "Safe title",
      body: "Safe body"
    })).rejects.toThrow();
    await expect(call(harness, "memory.enable", recordRequest)).rejects.toThrow();
    expect(harness.deleteMemory).not.toHaveBeenCalled();
    expect(harness.publishMemoryChanged).not.toHaveBeenCalled();
  });

  it("keeps export cancellation pathless and causes zero service or write effect", async () => {
    const harness = makeHarness({ showSaveDialog: async () => ({ canceled: true }) });
    const result = await call(harness, "memory.export", vaultRequest);
    expect(result).toEqual({
      apiVersion: 1,
      requestId: vaultRequest.requestId,
      activeVaultId,
      revision: vaultRequest.expectedRevision,
      status: "cancelled"
    });
    expect(JSON.stringify(result)).not.toMatch(/path|error|record|provenance/u);
    expect(harness.exportMemory).not.toHaveBeenCalled();
  });

  it("fails export closed when the active vault binding drifts during the dialog", async () => {
    let reads = 0;
    const harness = makeHarness({
      getActiveVaultBinding: () => reads++ === 0
        ? binding
        : { vaultId: activeVaultId, vaultPath: "/private/other-vault" }
    });
    await expect(call(harness, "memory.export", vaultRequest)).resolves.toEqual({
      apiVersion: 1,
      requestId: vaultRequest.requestId,
      activeVaultId,
      revision: vaultRequest.expectedRevision,
      status: "failed"
    });
    expect(harness.exportMemory).not.toHaveBeenCalled();
  });

  it("passes the selected destination only to the service and rejects private result fields", async () => {
    const harness = makeHarness({
      exportMemory: (_binding, request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        revision: request.expectedRevision,
        status: "exported",
        outputPath: "/private/export.json"
      })
    });
    await expect(call(harness, "memory.export", vaultRequest)).resolves.toEqual({
      apiVersion: 1,
      requestId: vaultRequest.requestId,
      activeVaultId,
      revision: vaultRequest.expectedRevision,
      status: "failed"
    });
    expect(harness.exportMemory).toHaveBeenCalledWith(binding, vaultRequest, "/private/export.json");
  });
});

function call(
  harness: ReturnType<typeof makeHarness>,
  channel: string,
  request: unknown
): Promise<unknown> {
  return Promise.resolve(harness.handlers.get(channel)!({ sender: {} } as IpcMainInvokeEvent, request));
}

function lifecycleResult(request: typeof recordRequest | typeof vaultRequest) {
  return {
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status: "committed" as const,
    operationId: "op_20260727_memoryipc",
    summary
  };
}
