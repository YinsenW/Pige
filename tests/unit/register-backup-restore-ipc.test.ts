import { describe, expect, it, vi } from "vitest";
import { registerBackupRestoreIpc } from "../../apps/desktop/src/main/register-backup-restore-ipc";

const request = {
  apiVersion: 1,
  requestId: "backupreconnectreq_abcdefgh",
  activeVaultId: "vault_20260726_reconnect01",
  waitingJobId: "job_20260726_reconnect01"
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
});

function sender() {
  return { id: 7, once: vi.fn(), isDestroyed: () => false };
}

function register(
  handlers: Map<string, (...args: any[]) => unknown>,
  overrides: {
    readonly reconnectDependency: ReturnType<typeof vi.fn>;
    readonly showOpenDialog: () => Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
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
    showMessageBox: async () => ({ response: 0 }),
    getActiveVault: () => undefined,
    getLastBackupAt: () => undefined,
    getLocale: () => "en",
    getDocumentsPath: () => "/documents",
    getBackupService: () => ({ status: () => ({}) }) as any,
    getBackupCoordinator: () => ({
      inspectReconnectCandidate: () => ({ status: "ready", candidate }),
      reconnectDependency: overrides.reconnectDependency
    }) as any,
    getRestoreCoordinator: () => ({}) as any,
    resumeBackgroundJobs: vi.fn()
  });
}
