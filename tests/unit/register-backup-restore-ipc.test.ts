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

describe("registerBackupRestoreIpc", () => {
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

function sender() {
  return { id: 7, once: vi.fn(), isDestroyed: () => false };
}

function register(
  handlers: Map<string, (...args: any[]) => unknown>,
  overrides: {
    readonly reconnectDependency: ReturnType<typeof vi.fn>;
    readonly continueIncomplete?: ReturnType<typeof vi.fn>;
    readonly inspectIncompleteCandidate?: () => unknown;
    readonly showOpenDialog: () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
    readonly showMessageBox?: () => Promise<{ readonly response: number }>;
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
    getActiveVault: () => undefined,
    getLastBackupAt: () => undefined,
    getLocale: () => "en",
    getDocumentsPath: () => "/documents",
    getBackupService: () => ({ status: () => ({}) }) as any,
    getBackupCoordinator: () => ({
      inspectReconnectCandidate: () => ({ status: "ready", candidate }),
      reconnectDependency: overrides.reconnectDependency,
      inspectIncompleteCandidate: overrides.inspectIncompleteCandidate ?? (() => ({
        status: "ready",
        candidate: incompleteCandidate
      })),
      continueIncomplete: overrides.continueIncomplete ?? vi.fn(async () => "continued" as const)
    }) as any,
    getRestoreCoordinator: () => ({}) as any,
    resumeBackgroundJobs: vi.fn()
  });
}
