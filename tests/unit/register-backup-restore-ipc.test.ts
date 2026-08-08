import { describe, expect, it, vi } from "vitest";
import { registerBackupRestoreIpc } from "../../apps/desktop/src/main/register-backup-restore-ipc";

const request = {
  apiVersion: 1,
  requestId: "backupreconnectreq_abcdefgh",
  activeVaultId: "vault_20260726_reconnect01",
  waitingJobId: "job_20260726_reconnect01"
} as const;
const continueRequest = {
  apiVersion: 1,
  requestId: "backupcontinuereq_abcdefgh",
  activeVaultId: request.activeVaultId,
  waitingJobId: request.waitingJobId,
  expectedJobUpdatedAt: "2026-07-26T00:00:00.000Z"
} as const;
const destinationRequest = {
  apiVersion: 1,
  requestId: "backupdestinationreconnectreq_abcdefgh",
  activeVaultId: request.activeVaultId,
  waitingJobId: request.waitingJobId,
  expectedJobUpdatedAt: "2026-07-26T00:00:00.000Z"
} as const;
const rollbackRestoreRequest = {
  apiVersion: 1,
  requestId: "restorerollbackreq_abcdefghijklmnop",
  activeVaultId: "vault_20260731_ipccancel01",
  restoreJobId: "job_20260731_ipccancel01",
  expectedRestoreJobUpdatedAt: "2026-07-31T00:00:00.000Z"
} as const;

describe("registerBackupRestoreIpc", () => {
  it("prepares only the current persisted replacement rollback as a pathless replace-only preview", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const rollbackRestoreCandidate = {
      activeVaultId: rollbackRestoreRequest.activeVaultId,
      restoreJobId: rollbackRestoreRequest.restoreJobId,
      expectedRestoreJobUpdatedAt: rollbackRestoreRequest.expectedRestoreJobUpdatedAt
    } as const;
    const prepareRollbackRestore = vi.fn(async () => ({ status: "prepared" as const, preview: rollbackArchivePreview }));
    register(handlers, {
      reconnectDependency: vi.fn(),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getActiveVault: () => ({ vaultId: rollbackRestoreRequest.activeVaultId }),
      getRestoreRollbackRestoreService: () => ({
        candidate: () => rollbackRestoreCandidate,
        prepare: prepareRollbackRestore
      })
    });

    expect(handlers.get("backup.rollbackRestoreStatus")?.({ sender: sender() })).toEqual({
      apiVersion: 1,
      status: "ready",
      candidate: rollbackRestoreCandidate
    });
    await expect(handlers.get("backup.prepareRollbackRestore")?.(
      { sender: sender() },
      rollbackRestoreRequest
    )).resolves.toMatchObject({
      ...rollbackRestoreRequest,
      status: "prepared",
      preview: {
        status: "ready",
        permittedModes: ["replace_existing"],
        defaultMode: "replace_existing"
      }
    });
    expect(prepareRollbackRestore).toHaveBeenCalledWith(rollbackRestoreRequest);
    expect(JSON.stringify(prepareRollbackRestore.mock.calls)).not.toContain("/private/");
    await expect(handlers.get("backup.prepareRollbackRestore")?.(
      { sender: sender() },
      { ...rollbackRestoreRequest, archivePath: "/private/rollback.zip" }
    )).rejects.toThrow();
  });

  it("binds the strict pathless conversation backup preference identity", () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const summary = {
      apiVersion: 1 as const,
      activeVaultId: "vault_20260801_conversationbackup01",
      revision: `backupconversationrev_${"a".repeat(64)}`,
      includeConversations: true,
      canUpdate: true
    };
    const update = vi.fn((value: { readonly requestId: string; readonly activeVaultId: string }) => ({
      apiVersion: 1 as const,
      requestId: value.requestId,
      activeVaultId: value.activeVaultId,
      status: "updated" as const,
      summary: { ...summary, revision: `backupconversationrev_${"b".repeat(64)}`, includeConversations: false }
    }));
    register(handlers, {
      reconnectDependency: vi.fn(),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getBackupConversationPreferenceService: () => ({ summary: () => summary, update })
    });
    expect(handlers.get("backup.conversationPreferenceStatus")?.({ sender: sender() })).toEqual(summary);
    const request = {
      apiVersion: 1,
      requestId: "backupconversationreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeConversations: false
    } as const;
    expect(handlers.get("backup.setConversationPreference")?.({ sender: sender() }, request)).toMatchObject({
      status: "updated",
      summary: { includeConversations: false }
    });
    expect(() => handlers.get("backup.setConversationPreference")?.({ sender: sender() }, { ...request, vaultPath: "/private/vault" })).toThrow();
  });

  it("binds the strict pathless Agent memory backup preference identity", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const summary = {
      apiVersion: 1 as const,
      activeVaultId: "vault_20260731_memorybackup01",
      revision: `backupmemoryrev_${"a".repeat(64)}`,
      includeVaultMemory: true,
      canUpdate: true
    };
    const update = vi.fn(() => ({
      apiVersion: 1 as const,
      requestId: "backupmemoryreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      status: "updated" as const,
      summary: { ...summary, revision: `backupmemoryrev_${"b".repeat(64)}`, includeVaultMemory: false }
    }));
    register(handlers, {
      reconnectDependency: vi.fn(),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getBackupMemoryPreferenceService: () => ({ summary: () => summary, update })
    });
    expect(handlers.get("backup.memoryPreferenceStatus")?.({ sender: sender() })).toEqual(summary);
    const request = {
      apiVersion: 1,
      requestId: "backupmemoryreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeVaultMemory: false
    } as const;
    expect(handlers.get("backup.setMemoryPreference")?.({ sender: sender() }, request)).toMatchObject({
      status: "updated",
      summary: { includeVaultMemory: false }
    });
    expect(() => handlers.get("backup.setMemoryPreference")?.(
      { sender: sender() },
      { ...request, configPath: "/private/vault/.pige/config.json" }
    )).toThrow();
    expect(JSON.stringify(update.mock.calls)).not.toContain("/private/");
  });

  it("binds the strict pathless trash backup preference identity", () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const summary = {
      apiVersion: 1 as const,
      activeVaultId: "vault_20260801_trashbackup0001",
      revision: `backuptrashrev_${"a".repeat(64)}`,
      includeTrash: true,
      canUpdate: true
    };
    const update = vi.fn((value: { readonly requestId: string; readonly activeVaultId: string }) => ({
      apiVersion: 1 as const,
      requestId: value.requestId,
      activeVaultId: value.activeVaultId,
      status: "updated" as const,
      summary: { ...summary, revision: `backuptrashrev_${"b".repeat(64)}`, includeTrash: false }
    }));
    register(handlers, {
      reconnectDependency: vi.fn(),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      getBackupTrashPreferenceService: () => ({ summary: () => summary, update })
    });
    expect(handlers.get("backup.trashPreferenceStatus")?.({ sender: sender() })).toEqual(summary);
    const input = {
      apiVersion: 1,
      requestId: "backuptrashreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      includeTrash: false
    } as const;
    expect(handlers.get("backup.setTrashPreference")?.({ sender: sender() }, input)).toMatchObject({
      status: "updated",
      summary: { includeTrash: false }
    });
    expect(() => handlers.get("backup.setTrashPreference")?.({ sender: sender() }, { ...input, trashPath: "/private" })).toThrow();
  });

  it("cancels only the exact sender-owned in-flight Restore preview without renderer path authority", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    let resolveApply: ((value: { readonly status: "canceled" }) => void) | undefined;
    const apply = vi.fn(() => new Promise<{ readonly status: "canceled" }>((resolve) => { resolveApply = resolve; }));
    const cancel = vi.fn(() => "cancel_requested" as const);
    let picker = 0;
    register(handlers, {
      reconnectDependency: vi.fn(),
      getBackupService: () => ({
        inspectRestoreArchive: async () => restoreArchivePreview,
        status: () => ({})
      }),
      getRestoreCoordinator: () => ({ apply, cancel }),
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: [picker++ === 0 ? "/private/main-only-backup.zip" : "/private/main-only-destination"]
      })
    });
    const owner = sender();
    const preview = await handlers.get("restore.preview")?.({ sender: owner }) as { readonly previewId: string };
    const applyPromise = handlers.get("restore.apply")?.(
      { sender: owner },
      { previewId: preview.previewId, mode: "clone_as_new" }
    ) as Promise<unknown>;
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const cancelRequest = {
      apiVersion: 1,
      requestId: "restorecancelreq_abcdefgh",
      previewId: preview.previewId,
      mode: "clone_as_new"
    } as const;

    expect(handlers.get("restore.cancel")?.({ sender: sender(8) }, cancelRequest))
      .toEqual({ ...cancelRequest, status: "stale" });
    expect(handlers.get("restore.cancel")?.({ sender: owner }, cancelRequest))
      .toEqual({ ...cancelRequest, status: "cancel_requested" });
    expect(cancel).toHaveBeenCalledWith(preview.previewId, "clone_as_new");
    expect(JSON.stringify(cancel.mock.calls)).not.toMatch(/backupPath|destinationPath|jobId/u);

    resolveApply?.({ status: "canceled" });
    await expect(applyPromise).resolves.toEqual({ status: "canceled" });
  });

  it("returns only the strict resolved identity after Main-owned repair and same-Job resume", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const reconnectDependency = vi.fn(() => "resolved" as const);
    register(handlers, {
      reconnectDependency,
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/private/main-only-root"] })
    });

    const result = await handlers.get("backup.reconnectDependency")?.(
      { sender: sender() },
      request
    );

    expect(result).toEqual({ ...request, status: "resolved" });
    expect(JSON.stringify(result)).not.toMatch(/path|dependencyId|job\s*:/u);
    expect(reconnectDependency).toHaveBeenCalledTimes(1);
  });

  it("keeps chooser cancellation mutation-free and rejects private request fields", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const reconnectDependency = vi.fn(() => "resolved" as const);
    register(handlers, {
      reconnectDependency,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });
    const handler = handlers.get("backup.reconnectDependency")!;

    await expect(handler({ sender: sender() }, { ...request, dependencyId: "root_private" }))
      .rejects.toThrow();
    await expect(handler({ sender: sender() }, request)).resolves.toEqual({ ...request, status: "cancelled" });
    expect(reconnectDependency).not.toHaveBeenCalled();
  });

  it("rechecks destination currentness after the Main picker and resumes only the exact same Job", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const reconnectDestination = vi.fn(() => "reconnected" as const);
    let inspections = 0;
    register(handlers, {
      reconnectDependency: vi.fn(),
      reconnectDestination,
      inspectDestinationReconnectCandidate: () => ++inspections === 1
        ? { status: "ready", candidate: destinationCandidate }
        : { status: "stale" },
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/private/main-only-backup-root"] })
    });

    await expect(handlers.get("backup.reconnectDestination")?.(
      { sender: sender() },
      destinationRequest
    )).resolves.toEqual({ ...destinationRequest, status: "stale" });
    expect(reconnectDestination).not.toHaveBeenCalled();

    inspections = 0;
    register(handlers, {
      reconnectDependency: vi.fn(),
      reconnectDestination,
      inspectDestinationReconnectCandidate: () => ({ status: "ready", candidate: destinationCandidate }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ["/private/main-only-backup-root"] })
    });
    await expect(handlers.get("backup.reconnectDestination")?.(
      { sender: sender() },
      destinationRequest
    )).resolves.toEqual({ ...destinationRequest, status: "reconnected" });
    expect(reconnectDestination).toHaveBeenCalledWith(destinationCandidate, "/private/main-only-backup-root");
  });

  it("confirms and continues the exact same incomplete Backup Job without private authority", async () => {
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const continueIncomplete = vi.fn(async () => "continued" as const);
    register(handlers, {
      reconnectDependency: vi.fn(),
      continueIncomplete,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });

    const result = await handlers.get("backup.continueIncomplete")?.(
      { sender: sender() },
      continueRequest
    );

    expect(result).toEqual({ ...continueRequest, status: "continued" });
    expect(JSON.stringify(result)).not.toMatch(/path|rootId|sourceId|error|job\s*:/u);
    expect(continueIncomplete).toHaveBeenCalledTimes(1);
  });

  it("keeps cancel and post-confirmation drift effect-free", async () => {
    const canceledHandlers = new Map<string, (...args: any[]) => unknown>();
    const canceledContinue = vi.fn();
    register(canceledHandlers, {
      reconnectDependency: vi.fn(),
      continueIncomplete: canceledContinue,
      showMessageBox: async () => ({ response: 1 }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });
    await expect(canceledHandlers.get("backup.continueIncomplete")?.(
      { sender: sender() },
      continueRequest
    )).resolves.toEqual({ ...continueRequest, status: "cancelled" });
    expect(canceledContinue).not.toHaveBeenCalled();

    const staleHandlers = new Map<string, (...args: any[]) => unknown>();
    const staleContinue = vi.fn();
    let inspections = 0;
    register(staleHandlers, {
      reconnectDependency: vi.fn(),
      continueIncomplete: staleContinue,
      inspectIncompleteCandidate: () => ++inspections === 1
        ? { status: "ready", candidate: incompleteCandidate }
        : { status: "stale" },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    });
    await expect(staleHandlers.get("backup.continueIncomplete")?.(
      { sender: sender() },
      continueRequest
    )).resolves.toEqual({ ...continueRequest, status: "stale" });
    expect(staleContinue).not.toHaveBeenCalled();
  });
});

const incompleteCandidate = {
  jobId: continueRequest.waitingJobId,
  vaultId: continueRequest.activeVaultId,
  jobUpdatedAt: continueRequest.expectedJobUpdatedAt,
  rootId: "root_private"
} as const;
const destinationCandidate = {
  jobId: destinationRequest.waitingJobId,
  vaultId: destinationRequest.activeVaultId,
  jobUpdatedAt: destinationRequest.expectedJobUpdatedAt,
  dependencyId: "backup_destination:0123456789abcdef"
} as const;

function sender(id = 7) {
  return { id, once: vi.fn(), isDestroyed: () => false };
}

function register(
  handlers: Map<string, (...args: any[]) => unknown>,
  overrides: {
    readonly reconnectDependency: ReturnType<typeof vi.fn>;
    readonly reconnectDestination?: ReturnType<typeof vi.fn>;
    readonly inspectDestinationReconnectCandidate?: () => unknown;
    readonly continueIncomplete?: ReturnType<typeof vi.fn>;
    readonly inspectIncompleteCandidate?: () => unknown;
    readonly showOpenDialog: () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
    readonly showMessageBox?: () => Promise<{ readonly response: number }>;
    readonly getBackupService?: () => unknown;
    readonly getRestoreCoordinator?: () => unknown;
    readonly getRestoreRollbackRestoreService?: () => unknown;
    readonly getBackupConversationPreferenceService?: () => unknown;
    readonly getBackupMemoryPreferenceService?: () => unknown;
    readonly getBackupTrashPreferenceService?: () => unknown;
    readonly getActiveVault?: () => unknown;
  }
): void {
  const candidate = {
    jobId: request.waitingJobId,
    vaultId: request.activeVaultId,
    jobUpdatedAt: "2026-07-26T00:00:00.000Z",
    dependencyKind: "vault_binding" as const,
    dependencyId: "root_private"
  };
  registerBackupRestoreIpc({
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => unknown) => { handlers.set(channel, handler); } },
    getWindow: () => ({} as any),
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: overrides.showOpenDialog,
    showMessageBox: overrides.showMessageBox ?? (async () => ({ response: 0 })),
    getActiveVault: (overrides.getActiveVault ?? (() => undefined)) as any,
    getLastBackupAt: () => undefined,
    getLocale: () => "en",
    getDocumentsPath: () => "/documents",
    getBackupService: (overrides.getBackupService ?? (() => ({ status: () => ({}) }))) as any,
    ...(overrides.getBackupConversationPreferenceService
      ? { getBackupConversationPreferenceService: overrides.getBackupConversationPreferenceService as any }
      : {}),
    ...(overrides.getBackupMemoryPreferenceService
      ? { getBackupMemoryPreferenceService: overrides.getBackupMemoryPreferenceService as any }
      : {}),
    ...(overrides.getBackupTrashPreferenceService
      ? { getBackupTrashPreferenceService: overrides.getBackupTrashPreferenceService as any }
      : {}),
    getBackupCoordinator: () => ({
      inspectReconnectCandidate: () => ({ status: "ready", candidate }),
      reconnectDependency: overrides.reconnectDependency,
      inspectDestinationReconnectCandidate: overrides.inspectDestinationReconnectCandidate ?? (() => ({
        status: "ready",
        candidate: destinationCandidate
      })),
      reconnectDestination: overrides.reconnectDestination ?? vi.fn(() => "reconnected" as const),
      inspectIncompleteCandidate: overrides.inspectIncompleteCandidate ?? (() => ({
        status: "ready",
        candidate: incompleteCandidate
      })),
      continueIncomplete: overrides.continueIncomplete ?? vi.fn(async () => "continued" as const)
    }) as any,
    getRestoreCoordinator: (overrides.getRestoreCoordinator ?? (() => ({}))) as any,
    getRestoreRollbackRestoreService: (overrides.getRestoreRollbackRestoreService ?? (() => ({
      candidate: () => undefined,
      prepare: async () => ({ status: "not_found" as const })
    }))) as any,
    resumeBackgroundJobs: vi.fn()
  });
}

const restoreArchivePreview = {
  backupPath: "/private/main-only-backup.zip",
  archivePreviewToken: `sha256:${"a".repeat(64)}`,
  archiveDigest: `sha256:${"b".repeat(64)}`,
  backupId: "backup_20260731_ipccancel01",
  backupIdSource: "manifest" as const,
  sourceVaultId: "vault_20260731_ipccancel01",
  invalidFileCount: 0,
  warnings: [],
  manifest: {
    schemaVersion: 1,
    backupId: "backup_20260731_ipccancel01",
    sourceVaultId: "vault_20260731_ipccancel01",
    createdAt: "2026-07-31T00:00:00.000Z",
    appVersion: "0.1.0-test",
    vaultSchemaVersion: 2,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false
    },
    counts: { notes: 0, sources: 0, managedSourceCopies: 0, conversations: 0, memories: 0, trashEntries: 0 },
    files: []
  }
};

const rollbackArchivePreview = {
  backupPath: "/private/main-only-rollback.zip",
  archivePreviewToken: `sha256:${"c".repeat(64)}`,
  archiveDigest: `sha256:${"d".repeat(64)}`,
  backupId: "backup_20260731_rollback01",
  backupIdSource: "manifest" as const,
  sourceVaultId: rollbackRestoreRequest.activeVaultId,
  invalidFileCount: 0,
  warnings: [],
  manifest: {
    formatVersion: 1 as const,
    format: "pige-backup" as const,
    appVersion: "0.1.0-test",
    vaultId: rollbackRestoreRequest.activeVaultId,
    vaultName: "Rollback fixture",
    vaultSchemaVersion: 2,
    createdAt: "2026-07-31T00:00:00.000Z",
    fileCount: 1,
    totalBytes: 1,
    noteCount: 0,
    sourceCount: 0,
    conversationCount: 0,
    memoryCount: 0,
    externalDependencyCount: 0,
    includedExternalDependencyCount: 0,
    missingRequiredExternalDependencyCount: 0,
    externalDependenciesComplete: true,
    includesSecrets: false as const,
    includes: {
      markdownKnowledge: true,
      sourceRecords: true,
      managedSourceCopies: true,
      conversations: true,
      vaultMemory: true,
      trash: true,
      rebuildableDatabaseCache: false,
      secrets: false as const
    }
  }
};
